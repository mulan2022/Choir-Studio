# 调试 recover-x-noteheads 在玉门关上的每一步
import importlib.util, subprocess, tempfile, sys
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile
from PIL import Image

spec = importlib.util.spec_from_file_location('rxn', 'scripts/recover-x-noteheads.py')
rxn = importlib.util.module_from_spec(spec); spec.loader.exec_module(rxn)

pdf = Path(r'C:\Users\MECHREVO\.kimi_openclaw\media\inbound\玉门关-PLS---d36a7410-56fe-4f5d-a89e-f8f84f82e250.pdf')
mxl = Path('_probe/omr-out/玉门关_PLS_d36a7410_56fe_4f5d_a89e_f8f84f82e250.mxl')

with ZipFile(mxl) as archive:
    names = archive.namelist()
    score_name = next(n for n in names if n.endswith('.xml') and not n.startswith('META-INF/'))
    score = ET.fromstring(archive.read(score_name))
parts = score.findall('part')
measures = [p.findall('measure') for p in parts]
print('parts:', len(parts), 'measures each:', [len(m) for m in measures])

with tempfile.TemporaryDirectory(prefix='choir-x-') as td:
    temp = Path(td)
    html = temp/'s.html'
    subprocess.run(['pdftotext','-bbox',str(pdf),str(html)],check=True,capture_output=True)
    doc = ET.parse(html).getroot()
    pages = doc.findall('.//{*}page')
    for pi, page in enumerate(pages, 1):
        words = page.findall('.//{*}word')
        has_x = any('¿' in ''.join(w.itertext()) or '×' in ''.join(w.itertext()) for w in words)
        print(f'--- page {pi}: has_x={has_x}')
        if not has_x: continue
        prefix = temp/f'pg{pi}'
        subprocess.run(['pdftoppm','-f',str(pi),'-l',str(pi),'-r','72','-gray','-png','-singlefile',str(pdf),str(prefix)],check=True,capture_output=True)
        img = Image.open(f'{prefix}.png')
        sx = img.width/float(page.get('width')); sy = img.height/float(page.get('height'))
        staves = rxn.staves_in(img)
        glyphs = rxn.cross_words(page, sx, sy)
        systems = rxn.systems_in(staves)
        print(f'  staves={len(staves)} systems={[len(s) for s in systems]} glyphs={len(glyphs)}')
        for si, group in enumerate(systems):
            bars = rxn.barlines_in(img, group)
            label = rxn.measure_label(page, group[0][0], sx, sy, bars[0]) if bars else None
            print(f'  sys{si}: bars={len(bars)} label={label} group0top={group[0][0]}')
            if len(bars) < 2: continue
            page_bars = len(bars)-1
            cond1 = label and label + page_bars - 1 <= len(measures[0])
            cond2 = len(pages)==1 and len(group)==len(parts) and sum(len(rxn.barlines_in(img,s))-1 for s in systems)==len(measures[0])
            print(f'    cond1(label)={bool(cond1)} cond2(single)={cond2} parts={len(parts)} group={len(group)}')
