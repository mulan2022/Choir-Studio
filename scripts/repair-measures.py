"""Reconcile printed time signatures with consecutive measures of note evidence.

Clear printed changes are anchors. Missing changes are inferred only from a
stable run of bars; unresolved disagreements stay visible for manual review.

    python scripts/repair-measures.py in.mxl out.musicxml [--report]
"""
from __future__ import annotations

import argparse
import sys
import zipfile
from collections import Counter
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


def observation(measure: ET.Element, divisions: int) -> tuple[float, bool] | None:
    """Vote using actual durations; never reinterpret tuplets to fit a meter."""
    notes = [node for node in measure if node.tag == 'note' and node.find('chord') is None]
    if not notes:
        return None
    if all(node.find('pitch') is None and node.find('unpitched') is None for node in notes):
        # A single three-beat whole-measure rest is useful meter evidence; a
        # four-beat one is too often Audiveris's generic placeholder.
        if len(notes) != 1 or notes[0].find('rest') is None:
            return None
        rest_beats = int(notes[0].findtext('duration', '0') or 0) / divisions
        if abs(rest_beats - 4) <= TOLERANCE or abs(rest_beats * 4 - round(rest_beats * 4)) > 0.08:
            return None
        return round(rest_beats * 4) / 4, False
    timed = events(measure, divisions)
    # In polyphonic Audiveris output a four-beat whole rest can share a bar
    # with three beats of pitched music. It is a placeholder, not a 4/4 vote.
    pitched = any(node.find('pitch') is not None or node.find('unpitched') is not None for node in notes)
    useful = [item for item in timed if item['note'] and not item['chord']
              and not (pitched and item['el'].find('rest') is not None
                       and item['el'].findtext('type') == 'whole'
                       and abs(item['end'] - item['start'] - 4) <= TOLERANCE)]
    actual = max((item['end'] for item in useful), default=0)
    if actual <= 0 or abs(actual * 4 - round(actual * 4)) > 0.08:
        return None
    return round(actual * 4) / 4, False


def repair_fingering_tuplets(root: ET.Element, report: list[str]) -> int:
    """Reject a narrow, corroborated fingering/tuplet ambiguity in OMR output.

    Requires a dense fingering passage, uniform written rhythm, and a matching
    part in the same bar (regular notes or independently dense fingerings). Mere duration mismatch is not evidence.
    Explicit brackets and mixed rhythms are left for manual review.
    """
    parts = [part.findall('measure') for part in root.findall('part')]
    repaired = 0
    for measures in parts:
        for index, measure in enumerate(measures):
            if any(node.tag in {'backup', 'forward'} for node in measure):
                continue
            notes = measure.findall('note')
            if len(notes) < 6 or any(n.find('pitch') is None or n.find('chord') is not None or n.find('grace') is not None or n.findall('dot') for n in notes):
                continue
            kind = notes[0].findtext('type')
            nominal = {'quarter': 1, 'eighth': 0.5, '16th': 0.25}.get(kind)
            if nominal is None or any(n.findtext('type') != kind for n in notes):
                continue
            marked = [n for n in notes if n.find('time-modification') is not None]
            if len(marked) not in {3, 4} or any(n.findtext('./time-modification/actual-notes') != '3' or n.findtext('./time-modification/normal-notes') != '2' for n in marked):
                continue
            if any(t.get('bracket') == 'yes' for n in marked for t in n.findall('./notations/tuplet')):
                continue
            if len(measure.findall('.//fingering')) < 3:
                continue
            divisions = divisions_at(measures, index)
            expected = meter_at(measures, index)
            if abs(len(notes) * nominal - expected) > TOLERANCE:
                continue
            if any(abs(int(n.findtext('duration', '0')) / divisions - nominal * (2 / 3 if n in marked else 1)) > TOLERANCE for n in notes):
                continue
            corroborated = False
            for other in parts:
                if other is measures or index >= len(other):
                    continue
                peers = other[index].findall('note')
                peer_divisions = divisions_at(other, index)
                peer_fingering = len(other[index].findall('.//fingering')) >= 3
                def matching_peer(n):
                    modification = n.find('time-modification')
                    ratio = 1
                    if modification is not None:
                        if not peer_fingering or modification.findtext('actual-notes') != '3' or modification.findtext('normal-notes') != '2' or any(t.get('bracket') == 'yes' for t in n.findall('./notations/tuplet')):
                            return False
                        ratio = 2 / 3
                    return (n.find('pitch') is not None and n.find('chord') is None and n.findtext('type') == kind
                            and not n.findall('dot') and abs(int(n.findtext('duration', '0')) / peer_divisions - nominal * ratio) <= TOLERANCE)
                if len(peers) == len(notes) and not any(n.tag in {'backup', 'forward'} for n in other[index]) and all(matching_peer(n) for n in peers):
                    corroborated = True
                    break
            if not corroborated:
                continue
            units = nominal * divisions
            if units != int(units):
                continue
            for note in marked:
                note.find('duration').text = str(int(units))
                note.remove(note.find('time-modification'))
                for notations in note.findall('notations'):
                    for tuplet in notations.findall('tuplet'):
                        notations.remove(tuplet)
                    if not len(notations):
                        note.remove(notations)
            repaired += 1
            report.append(f'第 {index + 1} 小节：指法数字与三连音混淆，依据指法序列及另一声部的相同节奏还原')
    return repaired


def adjust_generic_whole_rests(measure: ET.Element, divisions: int, expected: float) -> int:
    """Fit Audiveris's four-beat whole rests without moving another voice."""
    if expected >= 4 - TOLERANCE:
        return 0
    target = int(round(expected * divisions))
    nodes = list(measure)
    adjusted = 0
    for index, node in enumerate(nodes):
        if node.tag != 'note' or node.find('rest') is None or node.findtext('type') != 'whole':
            continue
        if int(node.findtext('duration', '0') or 0) != 4 * divisions:
            continue
        start = max((position for position in range(index) if nodes[position].tag == 'backup'), default=-1) + 1
        stop = next((position for position in range(index + 1, len(nodes)) if nodes[position].tag == 'backup'), len(nodes))
        timed = [other for other in nodes[start:stop] if other.tag in {'note', 'forward'}]
        if timed != [node]:
            continue
        following_backup = nodes[stop] if stop < len(nodes) else None
        if following_backup is not None and int(following_backup.findtext('duration', '0') or 0) != 4 * divisions:
            continue
        node.find('duration').text = str(target)
        if following_backup is not None:
            following_backup.find('duration').text = str(target)
        adjusted += 1
    return adjusted


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
        claim_count = 0
        for items in measures:
            time = items[index].find('./attributes/time')
            if time is not None:
                claims.add(meter_of(time))
                claim_count += 1
        if len(claims) != 1:
            continue
        candidate = length_of(*next(iter(claims)))
        if abs(candidate - current) <= 1e-6:
            continue
        window = range(index, min(index + EVIDENCE, count))
        actual = [reading[0] for j in window for items in measures
                  if (reading := observation(items[j], divisions_at(items, j))) is not None]
        enough_evidence = len(actual) >= len(window)
        fits_old = enough_evidence and all(abs(value - current) <= 0.34 for value in actual)
        fits_new = enough_evidence and all(abs(value - candidate) <= 0.34 for value in actual)
        if fits_old and not fits_new and claim_count < 2:
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
        actual = [reading[0] for items in measures
                  if (reading := observation(items[index], divisions_at(items, index))) is not None]
        best = None
        best_score = -1
        frequencies = Counter(claims.values())
        for claim in set(claims.values()):
            target = length_of(*claim)
            score = frequencies[claim] * 2 + sum(1 for value in actual if abs(value - target) <= 0.34)
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


def set_meter(measure: ET.Element, beats: int, beat_type: int) -> None:
    attributes = measure.find('attributes')
    if attributes is None:
        attributes = ET.Element('attributes')
        measure.insert(0, attributes)
    time = attributes.find('time')
    if time is None:
        time = ET.Element('time')
        before = next((i for i, node in enumerate(attributes) if node.tag in {'staves', 'clef', 'staff-details', 'transpose'}), len(attributes))
        attributes.insert(before, time)
    for node in list(time):
        if node.tag in {'beats', 'beat-type'}:
            time.remove(node)
    ET.SubElement(time, 'beats').text = str(beats)
    ET.SubElement(time, 'beat-type').text = str(beat_type)


def signature_for_run(measures: list[list[ET.Element]], start: int, end: int, value: float,
                      explicit: list[tuple[float, float]]) -> tuple[int, int] | None:
    if explicit:
        return int(explicit[0][0]), int(explicit[0][1])
    if abs(value - 3) > TOLERANCE:
        return (int(value), 4) if value.is_integer() else (int(value * 2), 8)
    simple = compound = 0
    for items in measures:
        for measure in items[start:end]:
            if any(node.tag in {'backup', 'forward'} for node in measure):
                continue
            notes = [node for node in measure.findall('note') if node.find('rest') is None and node.find('chord') is None]
            notation = sorted((note.findtext('type'), len(note.findall('dot'))) for note in notes)
            if notation in ([('quarter', 0)] * 3, [('half', 0), ('quarter', 0)], [('half', 1)]):
                simple += 1
            elif notation == [('quarter', 1)] * 2:
                compound += 2
            elif notation == [('eighth', 0)] * 6 or notation == [('eighth', 0)] * 3 + [('quarter', 1)]:
                compound += 1
    if compound >= 2 and compound > simple:
        return 6, 8
    if simple >= 2 and simple > compound:
        return 3, 4
    # The duration alone cannot distinguish 3/4 from 6/8.
    return None


def infer_meters(root: ET.Element, report: list[str]) -> tuple[int, set[ET.Element]]:
    """Infer missing changes from sustained agreement, then expose uncertainty."""
    measures = [part.findall('measure') for part in root.findall('part')]
    count = min(len(items) for items in measures) if measures else 0
    votes: list[tuple[float, int, int] | None] = []
    for index in range(count):
        readings = [observation(items[index], divisions_at(items, index)) for items in measures]
        printed = [meter_of(time) for items in measures if (time := items[index].find('./attributes/time')) is not None]
        current = meter_at(measures[0], index)
        values = [(2.0 if reading[1] and (abs(current - 2) <= TOLERANCE or any(abs(length_of(*claim) - 2) <= TOLERANCE for claim in printed)) else reading[0])
                  for reading in readings if reading is not None]
        ranking = Counter(values).most_common()
        if not ranking or (len(ranking) > 1 and ranking[0][1] == ranking[1][1]) or ranking[0][1] * 2 < len(values):
            votes.append(None)
        else:
            value, hits = ranking[0]
            votes.append((value, hits, len(values)) if 1 <= value <= 6 else None)

    changed = 0
    index = 0
    while index < count:
        if votes[index] is None:
            index += 1
            continue
        value = votes[index][0]
        end = index + 1
        while end < count and votes[end] is not None and abs(votes[end][0] - value) <= TOLERANCE:
            end += 1
        explicit = []
        conflicts = 0
        for position in range(index, end):
            claims = [meter_of(time) for items in measures if (time := items[position].find('./attributes/time')) is not None]
            explicit.extend(claim for claim in claims if abs(length_of(*claim) - value) <= TOLERANCE)
            if len(claims) >= 2 and all(abs(length_of(*claim) - value) > TOLERANCE for claim in claims):
                conflicts += 1
        multiple_parts = len(measures) > 1 and all(votes[j][1] >= 2 for j in range(index, end))
        threshold = (2 if multiple_parts else 3) + (2 if conflicts else 0)
        signature = signature_for_run(measures, index, end, value, explicit)
        strong = end - index >= threshold and signature is not None
        if strong:
            previous = meter_at(measures[0], index - 1) if index else 4.0
            for position in range(index, end):
                all_marked = all((time := items[position].find('./attributes/time')) is not None
                                 and abs(length_of(*meter_of(time)) - value) <= TOLERANCE for items in measures)
                has_conflict = any((time := items[position].find('./attributes/time')) is not None
                                   and abs(length_of(*meter_of(time)) - value) > TOLERANCE for items in measures)
                if (position == index and abs(previous - value) > TOLERANCE and not all_marked) or has_conflict:
                    for items in measures:
                        set_meter(items[position], int(signature[0]), int(signature[1]))
                    changed += 1
                    report.append(f'第 {position + 1} 小节：连续 {end - index} 小节支持 {int(signature[0])}/{int(signature[1])}，已补正拍号')
        index = end

    generic_rests = 0
    for index in range(count):
        expected = meter_at(measures[0], index)
        for items in measures:
            generic_rests += adjust_generic_whole_rests(items[index], divisions_at(items, index), expected)
    if generic_rests:
        report.append(f'按已确定拍号调整了 {generic_rests} 个泛用整小节休止符')

    uncertain: set[ET.Element] = set()
    for index in range(count):
        expected = meter_at(measures[0], index)
        for items in measures:
            reading = observation(items[index], divisions_at(items, index))
            if reading is not None and abs(measure_beats(items[index], divisions_at(items, index)) - expected) > TOLERANCE:
                uncertain.add(measures[0][index])
                break
    if uncertain:
        report.append(f'{len(uncertain)} 个小节的拍号与音符仍有冲突，保留原音符供人工校对')
    return changed, uncertain


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


def fix_part_lengths(root: ET.Element, report: list[str], uncertain: set[ET.Element]) -> tuple[int, int]:
    """Adjust whole-bar rests; preserve conflicting pitched notes for review."""
    measures = [part.findall('measure') for part in root.findall('part')]
    count = min(len(items) for items in measures) if measures else 0
    trimmed = padded = 0
    for index in range(count):
        if measures[0][index] in uncertain:
            continue
        expected = meter_at(measures[0], index)
        unsafe = False
        for items in measures:
            measure = items[index]
            length = measure_beats(measure, divisions_at(items, index))
            if abs(length - expected) <= TOLERANCE:
                continue
            notes = measure.findall('note')
            whole_rest = len(notes) == 1 and notes[0].find('rest') is not None and notes[0].find('rest').get('measure') == 'yes'
            if (length > expected and not whole_rest) or (length < expected and any(note.find('rest') is None for note in notes)):
                unsafe = True
                break
        if unsafe:
            uncertain.add(measures[0][index])
            continue
        for items in measures:
            divisions = divisions_at(items, index)
            measure = items[index]
            length = measure_beats(measure, divisions)
            if abs(length - expected) <= TOLERANCE:
                continue
            notes = measure.findall('note')
            whole_rest = len(notes) == 1 and notes[0].find('rest') is not None and notes[0].find('rest').get('measure') == 'yes'
            if whole_rest:
                measure.find('./note/duration').text = str(int(round(expected * divisions)))
                trimmed += 1
            elif length < expected and pad_measure(measure, divisions, expected - length, at_start=False):
                padded += 1
    if trimmed:
        report.append(f'调整了 {trimmed} 个整小节休止符的时值')
    return trimmed, padded


def repair_lengths(root: ET.Element, report: list[str], uncertain: set[ET.Element]) -> tuple[int, int]:
    measures = [part.findall('measure') for part in root.findall('part')]
    if not measures or any(not items for items in measures):
        return 0, 0
    splits = pads = 0
    index = 0
    while index < min(len(items) for items in measures):
        if measures[0][index] in uncertain:
            index += 1
            continue
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
    repair_fingering_tuplets(root, report)
    meters = fix_meters(root, report)
    aligned = align_meters(root, report)
    inferred, uncertain = infer_meters(root, report)
    trimmed, _ = fix_part_lengths(root, report, uncertain)
    splits, pads = repair_lengths(root, report, uncertain)
    renumber(root)
    save_score(root, args.output)

    measures = [part.findall('measure') for part in root.findall('part')]
    remaining = 0
    for index in range(min(len(items) for items in measures)):
        expected = meter_at(measures[0], index)
        if abs(lengths(measures, index) - expected) > TOLERANCE:
            remaining += 1
    print(f'撤销错误拍号 {meters} 处 / 调整整小节休止符 {trimmed} 处 / 统一跨声部 {aligned} 处 / 推断漏识别拍号 {inferred} 处 / 拆分 {splits} 小节 / 补休止符 {pads} 小节 / 仍有 {remaining} 小节对不上', flush=True)
    if args.report:
        for line in report:
            print('  ' + line, flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
