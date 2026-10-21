# Ritmo: 把 SA 合并声部按 voice 拆成 Soprano/Alto，重命名钢琴声部，输出可直接给 ChoirSinger 的 MXL
import sys
from music21 import converter, stream, note, chord, clef, key, meter

src, dst = sys.argv[1], sys.argv[2]
score = converter.parse(src)
parts = list(score.parts)
print('原声部数:', len(parts), [p.partName for p in parts])

sa = parts[0]
tb, primo, secondo = parts[1], parts[2], parts[3]

def split_sa(part, names):
    outs = [stream.Part() for _ in names]
    for o, n in zip(outs, names):
        o.partName = n
    measures = part.getElementsByClass(stream.Measure)
    for m in measures:
        voices = list(m.getElementsByClass(stream.Voice))
        for oi, o in enumerate(outs):
            nm = stream.Measure(number=m.number)
            for el in m.getElementsByClass(('Clef', 'KeySignature', 'TimeSignature')):
                nm.append(el)
            if voices:
                for v in voices:
                    if v.id == str(oi + 1) or (oi == 0 and not v.id.isdigit() == False and int(v.id) >= 3):
                        for e in v.elements:
                            if isinstance(e, (note.Note, note.Rest, chord.Chord)):
                                nm.append(e)
            else:
                for e in m.notesAndRests:
                    nm.append(e)
            o.append(nm)
    return outs

s_part, a_part = split_sa(sa, ['Soprano', 'Alto'])
tb.partName = 'TenorBass'
primo.partName = 'Piano'
secondo.partName = 'Piano'

new = stream.Score()
new.metadata = score.metadata
for p in (s_part, a_part, tb, primo, secondo):
    new.append(p)

for i, p in enumerate(new.parts):
    pn = list(p.recurse().notes)
    print(f'  part{i} {p.partName}: {len(pn)} notes, {len(p.getElementsByClass(stream.Measure))} measures')

new.write('musicxml', fp=dst, makeNotation=False)
print('已写出', dst)
