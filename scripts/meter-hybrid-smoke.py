"""Focused regression cases for printed meter plus rhythmic evidence."""

import importlib.util
import xml.etree.ElementTree as ET
from pathlib import Path

spec = importlib.util.spec_from_file_location('repair_measures', Path(__file__).with_name('repair-measures.py'))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


def score(lengths, parts=2, signatures=None, triplets=()):
    signatures = signatures or {0: (4, 4)}
    root = ET.Element('score-partwise', version='4.0')
    ET.SubElement(root, 'part-list')
    for part_index in range(parts):
        part = ET.SubElement(root, 'part', id=f'P{part_index + 1}')
        for index, length in enumerate(lengths):
            measure = ET.SubElement(part, 'measure', number=str(index + 1))
            if index in signatures:
                attributes = ET.SubElement(measure, 'attributes')
                ET.SubElement(attributes, 'divisions').text = '3'
                time = ET.SubElement(attributes, 'time')
                ET.SubElement(time, 'beats').text = str(signatures[index][0])
                ET.SubElement(time, 'beat-type').text = str(signatures[index][1])
            if index in triplets:
                for _ in range(3):
                    note = ET.SubElement(measure, 'note')
                    ET.SubElement(ET.SubElement(note, 'pitch'), 'step').text = 'C'
                    ET.SubElement(note, 'duration').text = '2'
                    ET.SubElement(note, 'type').text = 'quarter'
                    modification = ET.SubElement(note, 'time-modification')
                    ET.SubElement(modification, 'actual-notes').text = '3'
                    ET.SubElement(modification, 'normal-notes').text = '2'
            else:
                for _ in range(length):
                    note = ET.SubElement(measure, 'note')
                    ET.SubElement(ET.SubElement(note, 'pitch'), 'step').text = 'C'
                    ET.SubElement(note, 'duration').text = '3'
                    ET.SubElement(note, 'type').text = 'quarter'
    return root


def run(root):
    report = []
    repair.fix_meters(root, report)
    repair.align_meters(root, report)
    changed, uncertain = repair.infer_meters(root, report)
    repair.fix_part_lengths(root, report, uncertain)
    repair.repair_lengths(root, report, uncertain)
    measures = root.find('part').findall('measure')
    return [repair.meter_at(measures, i) for i in range(len(measures))], changed, uncertain, report


root = score([4, 4, 3, 3, 3, 3, 4, 4, 4])
meters, changed, uncertain, _ = run(root)
assert meters == [4, 4, 3, 3, 3, 3, 4, 4, 4] and changed == 2 and not uncertain, (meters, changed)

root = score([4, 3, 4])
meters, changed, uncertain, _ = run(root)
assert meters == [4, 4, 4] and changed == 0 and len(uncertain) == 1, (meters, changed, uncertain)
assert repair.measure_beats(root.find('part').findall('measure')[1], 3) == 3  # No silent padding.

root = score([4, 5, 4])
meters, changed, uncertain, _ = run(root)
assert meters == [4, 4, 4] and changed == 0 and len(uncertain) == 1, (meters, changed, uncertain)
assert repair.measure_beats(root.find('part').findall('measure')[1], 3) == 5  # No note trimming.

root = score([4, 4, 4, 4, 4], triplets={1, 2, 3, 4})
meters, changed, uncertain, _ = run(root)
assert meters == [4, 2, 2, 2, 2] and changed == 1 and not uncertain, (meters, changed, uncertain)
assert all(measure.find('.//time-modification') is not None for measure in root.find('part').findall('measure')[1:])  # Meter inference must not rewrite explicit tuplets.

root = score([2, 2, 2, 2], signatures={0: (2, 4)}, triplets={0, 1, 2, 3})
meters, changed, uncertain, _ = run(root)
assert meters == [2, 2, 2, 2] and changed == 0 and not uncertain, (meters, changed, uncertain)
assert root.find('.//time-modification') is not None  # Genuine 2/4 triplets survive.

root = score([4, 4, 4], signatures={0: (3, 4)})
meters, changed, uncertain, _ = run(root)
assert meters == [3, 3, 3] and changed == 0 and len(uncertain) == 3, (meters, changed, uncertain)

root = score([4, 3, 3, 3, 3, 4, 4])
for part in root.findall('part'):
    part.find('./measure/attributes/divisions').text = '6'
    for index, measure in enumerate(part.findall('measure')):
        for note in list(measure.findall('note')):
            measure.remove(note)
        for _ in range(2 if 1 <= index <= 4 else 4):
            note = ET.SubElement(measure, 'note')
            ET.SubElement(ET.SubElement(note, 'pitch'), 'step').text = 'C'
            ET.SubElement(note, 'duration').text = '9' if 1 <= index <= 4 else '6'
            ET.SubElement(note, 'type').text = 'quarter'
            if 1 <= index <= 4:
                ET.SubElement(note, 'dot')
meters, changed, uncertain, _ = run(root)
assert meters == [4, 3, 3, 3, 3, 4, 4] and changed == 2 and not uncertain, (meters, changed, uncertain)
assert root.find('./part/measure[2]/attributes/time/beat-type').text == '8'

# A generic whole rest in one voice must shrink with its backup cursor; the
# two dotted-quarter notes in the other voice must keep their original timing.
root = ET.Element('score-partwise', version='4.0')
ET.SubElement(root, 'part-list')
part = ET.SubElement(root, 'part', id='P1')
for index in range(3):
    measure = ET.SubElement(part, 'measure', number=str(index + 1))
    if index == 0:
        attributes = ET.SubElement(measure, 'attributes')
        ET.SubElement(attributes, 'divisions').text = '6'
        time = ET.SubElement(attributes, 'time')
        ET.SubElement(time, 'beats').text = '6'
        ET.SubElement(time, 'beat-type').text = '8'
    rest = ET.SubElement(measure, 'note')
    ET.SubElement(rest, 'rest')
    ET.SubElement(rest, 'duration').text = '24'
    ET.SubElement(rest, 'type').text = 'whole'
    ET.SubElement(ET.SubElement(measure, 'backup'), 'duration').text = '24'
    for _ in range(2):
        note = ET.SubElement(measure, 'note')
        ET.SubElement(ET.SubElement(note, 'pitch'), 'step').text = 'C'
        ET.SubElement(note, 'duration').text = '9'
        ET.SubElement(note, 'type').text = 'quarter'
        ET.SubElement(note, 'dot')
meters, changed, uncertain, _ = run(root)
assert meters == [3, 3, 3] and changed == 0 and not uncertain, (meters, changed, uncertain)
for measure in part.findall('measure'):
    assert measure.find('./note/duration').text == '18'
    assert measure.find('./backup/duration').text == '18'
    assert [note.findtext('duration') for note in measure.findall('note')[1:]] == ['9', '9']
    assert repair.measure_beats(measure, 6) == 3

# Explicit three-quarter tuplets must survive even under a conflicting 3/4.
root = score([3], signatures={0: (3, 4)}, triplets={0})
run(root)
assert len(root.findall('.//time-modification')) == 6


def fingering_fixture(bracket=False, fingerings=True, peer=True, malformed=False):
    root = score([4], parts=2 if peer else 1)
    for part_index, part in enumerate(root.findall('part')):
        measure = part.find('measure')
        measure.find('./attributes/divisions').text = '6'
        for note in list(measure.findall('note')):
            measure.remove(note)
        for index in range(8):
            triplet = part_index == 0 and index < (4 if malformed else 3)
            note = ET.SubElement(measure, 'note')
            ET.SubElement(ET.SubElement(note, 'pitch'), 'step').text = 'C'
            ET.SubElement(note, 'duration').text = '2' if triplet else '3'
            ET.SubElement(note, 'type').text = 'eighth'
            if triplet:
                mod = ET.SubElement(note, 'time-modification')
                ET.SubElement(mod, 'actual-notes').text = '3'
                ET.SubElement(mod, 'normal-notes').text = '2'
            if fingerings or triplet:
                marks = ET.SubElement(note, 'notations')
                if fingerings and index in {0, 2, 4, 6}:
                    ET.SubElement(ET.SubElement(marks, 'technical'), 'fingering').text = str(index % 5 + 1)
                if triplet and index == 0:
                    ET.SubElement(marks, 'tuplet', type='start', **({'bracket': 'yes'} if bracket else {}))
    return root

for malformed in [False, True]:
    root = fingering_fixture(malformed=malformed)
    assert repair.repair_fingering_tuplets(root, []) == 1
    assert not root.findall('.//time-modification')
    assert repair.measure_beats(root.find('./part/measure'), 6) == 4
for options in [{'bracket': True}, {'fingerings': False}, {'peer': False}]:
    root = fingering_fixture(**options)
    original = ET.tostring(root)
    assert repair.repair_fingering_tuplets(root, []) == 0
    assert ET.tostring(root) == original

print('hybrid meter and fingering/tuplet cases passed')
