# 逐门槛调试 page 1 sys0 的恢复流程
import importlib.util, subprocess, tempfile
from pathlib import Path
from statistics import median
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
settings = [rxn.part_settings(m) for m in measures]

with tempfile.TemporaryDirectory() as td:
    temp = Path(td)
    html = temp/'s.html'
    subprocess.run(['pdftotext','-bbox',str(pdf),str(html)],check=True,capture_output=True)
    doc = ET.parse(html).getroot()
    page = doc.findall('.//{*}page')[0]
    prefix = temp/'pg1'
    subprocess.run(['pdftoppm','-f','1','-l','1','-r','72','-gray','-png','-singlefile',str(pdf),str(prefix)],check=True,capture_output=True)
    img = Image.open(f'{prefix}.png')
    sx = img.width/float(page.get('width')); sy = img.height/float(page.get('height'))
    staves = rxn.staves_in(img)
    glyphs = rxn.cross_words(page, sx, sy)
    systems = rxn.systems_in(staves)
    print(f'glyphs({len(glyphs)}):', [(round(x),round(y)) for x,y in glyphs])

    group = systems[0]  # sys0
    bars = rxn.barlines_in(img, group)
    print('sys0 bars:', len(bars), bars)
    bounds = (group[0][0]-15, group[-1][-1]+15)
    print('sys0 bounds:', bounds)
    inside = [(round(x),round(y)) for x,y in glyphs if bars[0] < x < bars[-1] and bounds[0] <= y <= bounds[1]]
    print('glyphs inside sys0 x-range & y-bounds:', inside)

    for bar_index, (left, right) in enumerate(zip(bars, bars[1:])):
        items = []
        for x, y in glyphs:
            if left + 2 < x < right - 3 and bounds[0] <= y <= bounds[1]:
                si = min(range(len(group)), key=lambda i: abs(group[i][2] - y))
                if abs(group[si][2] - y) <= 24:
                    items.append((x, y, si))
        if items:
            print(f'bar{bar_index} ({round(left)}-{round(right)}): items={[(round(x),round(y),s) for x,y,s in items]}')
