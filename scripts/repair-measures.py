"""Repair time signatures and measure lengths in a recognised score.

Audiveris occasionally reads a stray glyph as a time-signature change. On
《玉门关》 that produced "66 个待校对小节" while the music itself was fine.

Two evidence-based passes, no OCR guessing:

  1. A meter change is kept only if the following measures really fit the new
     meter. If they fit the *previous* meter instead, the change is dropped.
  2. Whatever still does not fit is split at the barline (a merged pair of
     measures) or padded with rests; anything left is reported.

    python scripts/repair-measures.py in.mxl out.musicxml [--report]
"""
from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

TOLERANCE = 0.02
EVIDENCE = 3


def load_score(path: Path) -> ET.Element:
    if path.suffix.lower() == '.mxl':
        with zipfile.ZipFile(path) as archive:
            name = next(n for n in archive.namelist() if n.endswith('.xml') and not n.startswith('META-INF/'))
            return ET.fromstring(archive.read(name))
    return ET.parse(path).getroot()


def save_score(root: ET.Element, path: Path) -> None:
    ET.indent(root, space='  ')
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == '.mxl':
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('score.xml', ET.tostring(root, encoding='utf-8', xml_declaration=True))
        return
    ET.ElementTree(root).write(path, encoding='utf-8', xml_declaration=True)


def meter_of(time_element: ET.Element) -> tuple[float, float]:
    beats = 0.0
    for part in (time_element.findtext('beats', '4') or '4').split('+'):
        try:
            beats += float(part)
        except ValueError:
            beats += 4
    beat_type = float(time_element.findtext('beat-type', '4') or 4) or 4.0
    return beats, beat_type


def length_of(beats: float, beat_type: float) -> float:
    return beats * 4 / beat_type


def meter_at(measures: list[ET.Element], index: int) -> float:
    for measure in reversed(measures[:index + 1]):
        time = measure.find('./attributes/time')
        if time is not None:
            beats, beat_type = meter_of(time)
            return length_of(beats, beat_type)
    return 4.0


def divisions_at(measures: list[ET.Element], index: int) -> int:
    for measure in reversed(measures[:index + 1]):
        node = measure.find('./attributes/divisions')
        if node is not None and node.text:
            return int(node.text)
    return 1


def events(measure: ET.Element, divisions: int) -> list[dict]:
    items = []
    cursor = 0
    for child in measure:
        if child.tag == 'note':
            duration = int(child.findtext('duration', '0') or 0)
            chord = child.find('chord') is not None
            start = cursor - duration if chord else cursor
            items.append({'el': child, 'start': start / divisions, 'end': (start + duration) / divisions,
                          'chord': chord, 'note': True})
            if not chord:
                cursor += duration
        elif child.tag == 'backup':
            cursor -= int(child.findtext('duration', '0') or 0)
        elif child.tag == 'forward':
            duration = int(child.findtext('duration', '0') or 0)
            items.append({'el': child, 'start': cursor / divisions, 'end': (cursor + duration) / divisions,
                          'chord': False, 'note': False})
            cursor += duration
    return items


def measure_beats(measure: ET.Element, divisions: int) -> float:
    total = 0.0
    for item in events(measure, divisions):
        if item['note'] and not item['chord']:
            total = max(total, item['end'])
    return total


def lengths(measures: list[list[ET.Element]], index: int) -> float:
    return max((measure_beats(items[index], divisions_at(items, index)) for items in measures), default=0.0)


def fix_meters(root: ET.Element, report: list[str]) -> int:
    """Drop meter changes that the following measures do not support."""
    measures = [part.findall('measure') for part in root.findall('part')]
    if not measures:
        return 0
    count = min(len(items) for items in measures)
    current = meter_at(measures[0], 0)
    fixed = 0
    for index in range(count):
        claims = set()
        for items in measures:
            time = items[index].find('./attributes/time')
            if time is not None:
                claims.add(meter_of(time))
        if len(claims) != 1:
            continue
        candidate = length_of(*next(iter(claims)))
        if abs(candidate - current) <= 1e-6:
            continue
        window = range(index, min(index + EVIDENCE, count))
        actual = [lengths(measures, j) for j in window]
        fits_old = all(abs(value - current) <= 0.34 for value in actual)
        fits_new = all(abs(value - candidate) <= 0.34 for value in actual)
        if fits_old and not fits_new:
            for items in measures:
                attributes = items[index].find('attributes')
                time = attributes.find('time') if attributes is not None else None
                if time is not None:
                    attributes.remove(time)
            report.append(f'第 {index + 1} 小节：声称改成 {candidate:g} 拍，但音符还是 {current:g} 拍，已撤销')
            fixed += 1
        else:
            current = candidate
    return fixed


def align_meters(root: ET.Element, report: list[str]) -> int:
    """Give every part the same meter at every measure.

    Audiveris can put 6/8 in one part and 2/4 in another at the same bar, which
    makes every later measure look broken. The meter that explains most of the
    parts' actual note lengths wins; if nothing explains them, the previous
    meter is kept.
    """
    measures = [part.findall('measure') for part in root.findall('part')]
    if len(measures) < 2:
        return 0
    count = min(len(items) for items in measures)
    fixed = 0
    for index in range(count):
        claims = {}
        for part_index, items in enumerate(measures):
            time = items[index].find('./attributes/time')
            if time is not None:
                claims[part_index] = meter_of(time)
        if not claims:
            continue
        actual = [measure_beats(items[index], divisions_at(items, index)) for items in measures]
        best = None
        best_score = -1
        for claim in set(claims.values()):
            target = length_of(*claim)
            score = sum(1 for value in actual if abs(value - target) <= 0.34)
            if score > best_score:
                best, best_score = claim, score
        if best is None:
            continue
        previous = meter_at(measures[0], index - 1) if index else 0
        if best_score <= 0 and previous:
            best = (previous, 4.0) if abs(previous - round(previous)) < 1e-6 else best
        for part_index, items in enumerate(measures):
            attributes = items[index].find('attributes')
            time = attributes.find('time') if attributes is not None else None
            if time is None:
                continue
            current = meter_of(time)
            if current == best:
                continue
            beats_node = time.find('beats')
            type_node = time.find('beat-type')
            if beats_node is None or type_node is None:
                continue
            beats_node.text = str(int(best[0])) if float(best[0]).is_integer() else str(best[0])
            type_node.text = str(int(best[1]))
            fixed += 1
    if fixed:
        report.append(f'统一了 {fixed} 处各声部不一致的拍号')
    return fixed


def infer_meters(root: ET.Element, report: list[str]) -> int:
    """Make the meter agree with what the notes actually add up to.

    When Audiveris invents a 6/8 that nothing follows, the only reliable
    evidence is the music: if a bar and the two after it consistently hold the
    same number of beats, that is the meter.
    """
    from collections import Counter
    measures = [part.findall('measure') for part in root.findall('part')]
    count = min(len(items) for items in measures) if measures else 0
    changed = 0
    for index in range(count):
        actual = [round(measure_beats(items[index], divisions_at(items, index)) * 4) / 4 for items in measures]
        if not actual:
            continue
        value, hits = Counter(actual).most_common(1)[0]
        if value < 1 or hits * 2 < len(actual):
            continue
        current = meter_at(measures[0], index)
        if abs(value - current) <= TOLERANCE:
            continue
        ahead = []
        for j in range(index, min(index + 3, count)):
            ahead.extend(round(measure_beats(items[j], divisions_at(items, j)) * 4) / 4 for items in measures)
        if not ahead:
            continue
        ahead_value, ahead_hits = Counter(ahead).most_common(1)[0]
        if abs(ahead_value - value) > TOLERANCE or ahead_hits * 2 < len(ahead):
            continue
        for items in measures:
            attributes = items[index].find('attributes')
            if attributes is None:
                attributes = ET.Element('attributes')
                items[index].insert(0, attributes)
            time = attributes.find('time')
            if time is None:
                time = ET.SubElement(attributes, 'time')
                ET.SubElement(time, 'beats')
                ET.SubElement(time, 'beat-type')
            beats_node = time.find('beats')
            type_node = time.find('beat-type')
            beats_node.text = str(int(value)) if float(value).is_integer() else str(value)
            type_node.text = '4'
        changed += 1
        report.append(f'第 {index + 1} 小节：音符是 {value:g} 拍，拍号改成 {value:g}/4')
    return changed


def rest_note(duration: int) -> ET.Element:
    note = ET.Element('note')
    ET.SubElement(note, 'rest')
    ET.SubElement(note, 'duration').text = str(duration)
    ET.SubElement(note, 'voice').text = '1'
    ET.SubElement(note, 'type').text = {4: 'whole', 2: 'half', 1: 'quarter'}.get(duration, 'eighth')
    return note


def pad_measure(measure: ET.Element, divisions: int, deficit: float, at_start: bool) -> bool:
    budget = int(round(deficit * divisions))
    if budget <= 0:
        return False
    added = []
    for size in (4, 3, 2, 1):
        while budget >= size * divisions:
            added.append(rest_note(size * divisions))
            budget -= size * divisions
    if budget > 0:
        added.append(rest_note(budget))
    if not added:
        return False
    if at_start:
        for offset, note in enumerate(added):
            measure.insert(offset, note)
    else:
        for note in added:
            measure.append(note)
    return True


def split_measure(measure: ET.Element, divisions: int, split_beat: float) -> ET.Element | None:
    items = events(measure, divisions)
    boundary = next((item for item in items if abs(item['start'] - split_beat) < 0.02), None)
    if boundary is None:
        return None
    index = list(measure).index(boundary['el'])
    if index == 0:
        return None
    head, tail = list(measure)[:index], list(measure)[index:]
    remainder = ET.Element('measure')
    for child in tail:
        remainder.append(child)
    for child in list(measure):
        measure.remove(child)
    for child in head:
        measure.append(child)
    for item in items:
        if not item['note'] or item['start'] >= split_beat - 0.02 or item['end'] <= split_beat + 0.02:
            continue
        note = item['el']
        duration = int(note.findtext('duration', '0') or 0)
        head_duration = int(round((split_beat - item['start']) * divisions))
        tail_duration = duration - head_duration
        if head_duration <= 0 or tail_duration <= 0:
            continue
        ET.SubElement(note, 'tie', type='start')
        notations = note.find('notations')
        if notations is None:
            notations = ET.SubElement(note, 'notations')
        ET.SubElement(notations, 'tied', type='start')
        note.find('duration').text = str(head_duration)
        clone = ET.fromstring(ET.tostring(note))
        clone.find('duration').text = str(tail_duration)
        for tie in clone.findall('tie'):
            tie.set('type', 'stop')
        for tied in clone.findall('./notations/tied'):
            tied.set('type', 'stop')
        remainder.insert(0, clone)
    return remainder


def fix_part_lengths(root: ET.Element, report: list[str]) -> tuple[int, int]:
    """Trim or pad the parts of a measure that disagree with each other.

    Audiveris often sustains a note past the barline instead of tying it into
    the next bar. Trimming the overflow keeps the bar legal without changing how
    many measures or notes exist.
    """
    measures = [part.findall('measure') for part in root.findall('part')]
    count = min(len(items) for items in measures) if measures else 0
    trimmed = padded = 0
    for index in range(count):
        expected = meter_at(measures[0], index)
        for items in measures:
            divisions = divisions_at(items, index)
            measure = items[index]
            length = measure_beats(measure, divisions)
            if abs(length - expected) <= TOLERANCE:
                continue
            if length > expected + TOLERANCE:
                excess = int(round((length - expected) * divisions))
                for note in reversed([item['el'] for item in events(measure, divisions) if item['note'] and not item['chord']]):
                    if excess <= 0:
                        break
                    duration = int(note.findtext('duration', '0') or 0)
                    take = min(duration, excess)
                    note.find('duration').text = str(duration - take)
                    excess -= take
                    if duration - take <= 0:
                        measure.remove(note)
                trimmed += 1
            elif pad_measure(measure, divisions, expected - length, at_start=False):
                padded += 1
    if trimmed:
        report.append(f'裁掉 {trimmed} 处越过小节线多出来的时值')
    return trimmed, padded


def repair_lengths(root: ET.Element, report: list[str]) -> tuple[int, int]:
    measures = [part.findall('measure') for part in root.findall('part')]
    if not measures or any(not items for items in measures):
        return 0, 0
    splits = pads = 0
    index = 0
    while index < min(len(items) for items in measures):
        expected = meter_at(measures[0], index)
        worst = lengths(measures, index)
        if abs(worst - expected) <= TOLERANCE:
            index += 1
            continue
        if worst > expected + TOLERANCE:
            remainders = [split_measure(items[index], divisions_at(items, index), expected) for items in measures]
            if all(remainder is not None for remainder in remainders):
                for items, remainder in zip(measures, remainders):
                    items.insert(items.index(items[index]) + 1, remainder)
                splits += 1
                report.append(f'第 {index + 1} 小节：{worst:g} 拍 > {expected:g} 拍，已拆成两小节')
                index += 2
                continue
        if worst < expected - TOLERANCE:
            shifted = False
            for items in measures:
                found = events(items[index], divisions_at(items, index))
                if found:
                    shifted = found[0]['start'] > 0.1
                    break
            changed = False
            for items in measures:
                if pad_measure(items[index], divisions_at(items, index), expected - worst, at_start=shifted):
                    changed = True
            if changed:
                pads += 1
                report.append(f'第 {index + 1} 小节：少 {expected - worst:g} 拍，已补休止符')
        index += 1
    return splits, pads


def renumber(root: ET.Element) -> None:
    for part in root.findall('part'):
        for number, measure in enumerate(part.findall('measure'), 1):
            measure.set('number', str(number))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--report', action='store_true')
    args = parser.parse_args()

    root = load_score(args.input)
    report: list[str] = []
    meters = fix_meters(root, report)
    aligned = align_meters(root, report)
    inferred = infer_meters(root, report)
    trimmed, _ = fix_part_lengths(root, report)
    splits, pads = repair_lengths(root, report)
    renumber(root)
    save_score(root, args.output)

    measures = [part.findall('measure') for part in root.findall('part')]
    remaining = 0
    for index in range(min(len(items) for items in measures)):
        expected = meter_at(measures[0], index)
        if abs(lengths(measures, index) - expected) > TOLERANCE:
            remaining += 1
    print(f'撤销错误拍号 {meters} 处 / 裁掉越界 {trimmed} 处 / 统一跨声部 {aligned} 处 / 按音符长度改拍号 {inferred} 处 / 拆分 {splits} 小节 / 补休止符 {pads} 小节 / 仍有 {remaining} 小节对不上', flush=True)
    if args.report:
        for line in report:
            print('  ' + line, flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
