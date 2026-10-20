"""Transfer cross-measure ties only where Audiveris and homr agree on pitch and edge notes.

The source PDF stays untouched. This produces a new MusicXML for local review.
"""

import argparse
import collections
import pathlib
import xml.etree.ElementTree as ET
import zipfile


def notes_in_measure(measure):
    divisions = int(measure.findtext('./attributes/divisions') or 1)
    cursor = 0.0
    last_start = 0.0
    notes = []
    for element in measure:
        if element.tag == 'attributes':
            divisions = int(element.findtext('divisions') or divisions)
        elif element.tag == 'backup':
            cursor -= int(element.findtext('duration') or 0) / divisions
        elif element.tag == 'forward':
            cursor += int(element.findtext('duration') or 0) / divisions
        elif element.tag == 'note':
            duration = int(element.findtext('duration') or 0) / divisions
            start = last_start if element.find('chord') is not None else cursor
            last_start = start
            if element.find('pitch') is not None:
                pitch = element.find('pitch')
                midi = (int(pitch.findtext('octave')) + 1) * 12 + {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[pitch.findtext('step')] + int(pitch.findtext('alter') or 0)
                types = {tie.get('type') for tie in element.findall('tie') + element.findall('./notations/tied')}
                notes.append((start, start + duration, midi, types, element))
            if element.find('chord') is None:
                cursor += duration
    return notes


def edge_pair(part, index):
    measures = part.findall('measure')
    left = notes_in_measure(measures[index])
    right = notes_in_measure(measures[index + 1])
    if not left or not right:
        return []
    end = max(note[1] for note in left)
    return [(a, b) for a in left for b in right if a[2] == b[2] and abs(a[1] - end) < 0.02 and abs(b[0]) < 0.02]


def ensure_tie(note, kind):
    if kind not in {tie.get('type') for tie in note.findall('tie')}:
        ET.SubElement(note, 'tie', type=kind)
    notations = note.find('notations')
    if notations is None:
        notations = ET.SubElement(note, 'notations')
    if kind not in {tie.get('type') for tie in notations.findall('tied')}:
        ET.SubElement(notations, 'tied', type=kind)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent
    source = root / 'exports' / '蒲公英-自动识谱.mxl'
    hybrid = root / 'exports' / '蒲公英-homr混合版.musicxml'
    output = root / 'exports' / '蒲公英-homr补全延音实验版.musicxml'
    with zipfile.ZipFile(source) as archive:
        entry = next(name for name in archive.namelist() if name.endswith('.xml') and not name.startswith('META-INF/'))
        audiveris = ET.fromstring(archive.read(entry))
    tree = ET.parse(hybrid)
    homr = tree.getroot()
    old_parts = audiveris.findall('part')[2:6]
    new_parts = homr.findall('part')[:4]
    counts = collections.Counter()
    details = []
    for role, (old, new) in zip('SATB', zip(old_parts, new_parts)):
        for i in range(min(len(old.findall('measure')), len(new.findall('measure'))) - 1):
            old_ties = [(a, b) for a, b in edge_pair(old, i) if 'start' in a[3] and 'stop' in b[3]]
            if not old_ties:
                continue
            counts[f'{role} source'] += len(old_ties)
            for left, right in old_ties:
                candidates = [(a, b) for a, b in edge_pair(new, i) if a[2] == left[2]]
                if len(candidates) != 1:
                    counts[f'{role} unmatched'] += 1
                    continue
                first, second = candidates[0]
                if 'start' in first[3] and 'stop' in second[3]:
                    counts[f'{role} existing'] += 1
                    continue
                counts[f'{role} repaired'] += 1
                details.append((role, i + 1, i + 2, left[2]))
                if args.write:
                    ensure_tie(first[4], 'start')
                    ensure_tie(second[4], 'stop')
    print(dict(counts))
    print('Examples:', details[:25])
    if args.write:
        title = homr.find('./work/work-title')
        if title is not None:
            title.text = '蒲公英（双引擎延音校对实验版）'
        tree.write(output, encoding='utf-8', xml_declaration=True)
        print('Wrote:', output)


if __name__ == '__main__':
    main()
