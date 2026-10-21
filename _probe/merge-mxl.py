# 合并分段 MusicXML（同 part 结构，按页序拼接 measure，重编号）
import sys, re, zipfile, shutil, os

files = sys.argv[1:-1]
out = sys.argv[-1]

def read_xml(path):
    with zipfile.ZipFile(path) as z:
        name = [n for n in z.namelist() if n.endswith('.xml') and 'META-INF' not in n][0]
        return z.read(name).decode('utf-8')

xmls = [read_xml(f) for f in files]

# 用第一个文件做骨架
base = xmls[0]
head, rest = base.split('<part id="', 1)
part_list_block = head[head.index('<part-list>'):head.index('</part-list>') + len('</part-list>')] if '<part-list>' in head else None

# 逐 part 收集所有文件的 measure
parts_merged = []
for f in files:
    x = read_xml(f)
    parts = re.split(r'(?=<part id=")', x)
    body = [p for p in parts if p.startswith('<part id="')]
    for i, p in enumerate(body):
        if len(parts_merged) <= i:
            parts_merged.append([])
        m = re.search(r'<part id="([^"]+)"', p)
        open_tag = f'<part id="{m.group(1)}">'
        content = p[p.index('>', p.index('<part id')) + 1:]
        content = content[:content.rindex('</part>')]
        measures = re.findall(r'<measure[^>]*>.*?</measure>', content, re.S)
        parts_merged[i].extend(measures)

out_parts = []
for i, measures in enumerate(parts_merged):
    inner = []
    for n, m in enumerate(measures, 1):
        inner.append(re.sub(r'<measure number="[^"]*"', f'<measure number="{n}"', m, count=1))
    out_parts.append(f'<part id="P{i+1}">\n' + '\n'.join(inner) + '\n</part>')

# 重映射 part-list 的 id
plist = part_list_block
for i in range(len(parts_merged), 0, -1):
    plist = plist.replace(f'id="P{i}"', f'id="TMPP{i}"')
for i in range(1, len(parts_merged) + 1):
    plist = plist.replace(f'id="TMPP{i}"', f'id="P{i}"')

new_head = head[:head.index('<part-list>')] + plist + '\n'
doc = new_head + '\n'.join(out_parts) + '\n</score-partwise>'

os.makedirs(os.path.dirname(out), exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('score.xml', doc)
print(f'merged {len(files)} files -> {out}, parts={len(parts_merged)}, measures={[len(m) for m in parts_merged]}')
