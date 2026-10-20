"""Recover vector PDF cross noteheads omitted by Audiveris.

The recovery is intentionally conservative: it needs five-line staves,
visible barlines, and regular eighth-note columns. It leaves uncertain bars
untouched rather than inserting guessed sounds.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from io import BytesIO
from pathlib import Path
from statistics import median
import subprocess
import sys
from tempfile import TemporaryDirectory
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from PIL import Image


STEPS = 'CDEFGAB'


def run(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def staves_in(image: Image.Image) -> list[list[int]]:
    gray = image.convert('L')
    width, height = gray.size
    left, right = int(width * .17), int(width * .93)
    threshold = (right - left) * .62
    dark_rows = []
    for y in range(height):
        dark = sum(gray.getpixel((x, y)) < 125 for x in range(left, right))
        if dark >= threshold:
            dark_rows.append(y)
    lines = []
    for y in dark_rows:
        if lines and y - lines[-1][-1] <= 1:
            lines[-1].append(y)
        else:
            lines.append([y])
    centers = [round(median(line)) for line in lines]
    staves = []
    for i in range(0, len(centers) - 4):
        group = centers[i:i + 5]
        intervals = [b - a for a, b in zip(group, group[1:])]
        if 3 <= median(intervals) <= 15 and max(intervals) - min(intervals) <= 3:
            if not staves or group[0] > staves[-1][-1] + 12:
                staves.append(group)
    return staves


def systems_in(staves: list[list[int]]) -> list[list[list[int]]]:
    systems = []
    for staff in staves:
        if not systems or staff[0] - systems[-1][-1][-1] > 65:
            systems.append([staff])
        else:
            systems[-1].append(staff)
    return systems


def barlines_in(image: Image.Image, staves: list[list[int]]) -> list[int]:
    gray = image.convert('L')
    width, _ = gray.size
    found = []
    for x in range(int(width * .12), int(width * .95)):
        counts = [sum(gray.getpixel((x, y)) < 125 for y in range(staff[0], staff[-1] + 1)) for staff in staves]
        if min(counts) >= 15:
            found.append(x)
    groups = []
    for x in found:
        if groups and x - groups[-1][-1] <= 5:
            groups[-1].append(x)
        else:
            groups.append([x])
    return [group[-1] for group in groups]


def cross_words(page: ET.Element, sx: float, sy: float) -> list[tuple[float, float]]:
    words = []
    for word in page.findall('.//{*}word'):
        text = ''.join(word.itertext()).strip()
        if not text or not all(char in '¿×' for char in text):
            continue
        x0, x1 = float(word.get('xMin')), float(word.get('xMax'))
        y0, y1 = float(word.get('yMin')), float(word.get('yMax'))
        if x1 - x0 > 14 or y1 - y0 > 26:
            continue
        count = min(2, len(text))
        if count == 1:
            words.append(((x0 + x1) * .5 * sx, (y0 + y1) * .5 * sy))
        else:
            # Closely stacked crossed noteheads are grouped into one PDF word.
            delta = max(2.0, ((y1 - y0) - 17) * .5)
            middle = (y0 + y1) * .5
            for sign in [-1, 1]:
                words.append(((x0 + x1) * .5 * sx, (middle + sign * delta) * sy))
    return words


def measure_label(page: ET.Element, staff_y: float, sx: float, sy: float, left: float) -> int | None:
    for word in page.findall('.//{*}word'):
        text = ''.join(word.itertext()).strip()
        if not text.isdigit() or not 2 <= len(text) <= 4:
            continue
        x = float(word.get('xMin')) * sx
        y = float(word.get('yMax')) * sy
        if left - 8 <= x <= left + 35 and staff_y - 30 <= y <= staff_y - 3:
            return int(text)
    return None


def note_pitch(staff: list[int], head_y: float, clef: str, octave_change: int, fifths: int) -> tuple[str, int, int]:
    space = median([b - a for a, b in zip(staff, staff[1:])])
    offset = round((staff[2] - head_y) / (space / 2))
    base = 4 * 7 + STEPS.index('B') if clef == 'G' else 3 * 7 + STEPS.index('D')
    index = base + offset + octave_change * 7
    step, octave = STEPS[index % 7], index // 7
    flats = 'BEADGCF'[:max(0, -fifths)]
    sharps = 'FCGDAEB'[:max(0, fifths)]
    alter = -1 if step in flats else 1 if step in sharps else 0
    return step, octave, alter


def append_rest(measure: ET.Element, units: int, voice: str, unit_duration: int) -> None:
    for amount, kind in [(8, 'whole'), (4, 'half'), (2, 'quarter'), (1, 'eighth')]:
        while units >= amount:
            rest = ET.SubElement(measure, 'note')
            ET.SubElement(rest, 'rest')
            ET.SubElement(rest, 'duration').text = str(amount * unit_duration)
            ET.SubElement(rest, 'voice').text = voice
            ET.SubElement(rest, 'type').text = kind
            units -= amount


def append_cross(measure: ET.Element, pitches: list[tuple[str, int, int]], voice: str, unit_duration: int) -> None:
    for i, (step, octave, alter) in enumerate(pitches):
        note = ET.SubElement(measure, 'note')
        if i:
            ET.SubElement(note, 'chord')
        pitch = ET.SubElement(note, 'pitch')
        ET.SubElement(pitch, 'step').text = step
        if alter:
            ET.SubElement(pitch, 'alter').text = str(alter)
        ET.SubElement(pitch, 'octave').text = str(octave)
        ET.SubElement(note, 'duration').text = str(unit_duration)
        ET.SubElement(note, 'voice').text = voice
        ET.SubElement(note, 'type').text = 'eighth'
        ET.SubElement(note, 'notehead').text = 'x'


def insert_crosses(measure: ET.Element, slots: dict[int, list[tuple[str, int, int]]], divisions: int, beats: float) -> int:
    if divisions % 2 or not slots:
        return 0
    unit_duration = divisions // 2
    units = round(beats * 2)
    if measure.findall('.//notehead'):
        return 0
    existing_pitched = any(note.find('pitch') is not None or note.find('unpitched') is not None for note in measure.findall('note'))
    if existing_pitched:
        # Keep pitched OMR notes in their own voice. Compute its last cursor
        # position so the new voice starts at the beginning of this bar.
        cursor = 0
        for node in measure:
            if node.tag == 'backup':
                cursor -= int(node.findtext('duration', '0'))
            elif node.tag == 'forward':
                cursor += int(node.findtext('duration', '0'))
            elif node.tag == 'note' and node.find('chord') is None:
                cursor += int(node.findtext('duration', '0'))
        if cursor > 0:
            ET.SubElement(ET.SubElement(measure, 'backup'), 'duration').text = str(cursor)
        voice = '99'
    else:
        for node in list(measure):
            if node.tag in {'note', 'backup', 'forward'}:
                measure.remove(node)
        voice = '1'
    position = 0
    for slot in sorted(slots):
        if slot >= units:
            continue
        append_rest(measure, slot - position, voice, unit_duration)
        append_cross(measure, slots[slot], voice, unit_duration)
        position = slot + 1
    append_rest(measure, units - position, voice, unit_duration)
    return sum(len(pitches) for slot, pitches in slots.items() if slot < units)


def measure_beats(previous_measures: list[ET.Element]) -> float:
    for measure in reversed(previous_measures):
        time = measure.find('./attributes/time')
        if time is None:
            continue
        counts = [int(x) for x in time.findtext('beats', '4').split('+')]
        denominator = int(time.findtext('beat-type', '4'))
        return sum(counts) * 4 / denominator
    return 4


def part_settings(measures: list[ET.Element]) -> list[tuple[str, int, int]]:
    clef, octave_change, fifths = 'G', 0, 0
    states = []
    for measure in measures:
        for attributes in measure.findall('attributes'):
            key = attributes.find('key/fifths')
            if key is not None:
                fifths = int(key.text)
            printed_clef = attributes.find('clef')
            if printed_clef is not None:
                clef = printed_clef.findtext('sign', clef)
                octave_change = int(printed_clef.findtext('clef-octave-change', '0'))
        states.append((clef, octave_change, fifths))
    return states


def recover(pdf: Path, mxl: Path, output: Path) -> int:
    with ZipFile(mxl) as archive:
        names = archive.namelist()
        score_name = next(name for name in names if name.endswith('.xml') and not name.startswith('META-INF/'))
        source = {name: archive.read(name) for name in names}
    score = ET.fromstring(source[score_name])
    parts = score.findall('part')
    if not parts:
        return 0
    measures = [part.findall('measure') for part in parts]
    if len({len(items) for items in measures}) != 1:
        return 0
    settings = [part_settings(items) for items in measures]
    with TemporaryDirectory(prefix='choir-x-') as temp_name:
        temp = Path(temp_name)
        html = temp / 'score.html'
        run('pdftotext', '-bbox', str(pdf), str(html))
        document = ET.parse(html).getroot()
        pages = document.findall('.//{*}page')
        total = 0
        for page_index, page in enumerate(pages, 1):
            if not any('¿' in ''.join(word.itertext()) or '×' in ''.join(word.itertext()) for word in page.findall('.//{*}word')):
                continue
            prefix = temp / f'page-{page_index}'
            run('pdftoppm', '-f', str(page_index), '-l', str(page_index), '-r', '72', '-gray', '-png', '-singlefile', str(pdf), str(prefix))
            image = Image.open(f'{prefix}.png')
            sx = image.width / float(page.get('width'))
            sy = image.height / float(page.get('height'))
            staves = staves_in(image)
            if not staves:
                continue
            glyphs = cross_words(page, sx, sy)
            systems = systems_in(staves)
            for system_index, group in enumerate(systems):
                bars = barlines_in(image, group)
                if len(bars) < 2:
                    continue
                label = measure_label(page, group[0][0], sx, sy, bars[0])
                page_bars = len(bars) - 1
                if label and label + page_bars - 1 <= len(measures[0]):
                    first_measure = label - 1
                elif len(pages) == 1 and len(group) == len(parts) and sum(len(barlines_in(image, system)) - 1 for system in systems) == len(measures[0]):
                    first_measure = sum(len(barlines_in(image, system)) - 1 for system in systems[:system_index])
                else:
                    continue
                if len(group) == len(parts):
                    part_indices = list(range(len(parts)))
                elif 4 <= len(group) < len(parts):
                    # Some scores reduce to SATB after earlier divisi and
                    # percussion staves vanish. Only map the visible tail if
                    # every preceding MusicXML part is silent in these bars.
                    first_visible = len(parts) - len(group)
                    preceding = parts[:first_visible]
                    if any(measures[part_index][measure_index].find('.//pitch') is not None
                           for part_index in range(first_visible)
                           for measure_index in range(first_measure, min(first_measure + page_bars, len(measures[0])))):
                        continue
                    part_indices = list(range(first_visible, len(parts)))
                else:
                    continue
                bounds = (group[0][0] - 15, group[-1][-1] + 15)
                system_x = sorted(x for x, y in glyphs if bars[0] < x < bars[-1] and bounds[0] <= y <= bounds[1])
                system_groups = []
                for x in system_x:
                    if not system_groups or x - system_groups[-1][-1] > 6:
                        system_groups.append([x])
                    else:
                        system_groups[-1].append(x)
                system_columns = [median(group) for group in system_groups]
                system_diffs = [b - a for a, b in zip(system_columns, system_columns[1:]) if 10 <= b - a <= 25]
                system_step = median(system_diffs) if system_diffs else None
                for bar_index, (left, right) in enumerate(zip(bars, bars[1:])):
                    items = []
                    for x, y in glyphs:
                        if left + 2 < x < right - 3 and bounds[0] <= y <= bounds[1]:
                            staff_index = min(range(len(group)), key=lambda i: abs(group[i][2] - y))
                            if abs(group[staff_index][2] - y) <= 24:
                                items.append((x, y, staff_index))
                    if len(items) < 2:
                        continue
                    column_groups = []
                    for x in sorted(x for x, _, _ in items):
                        if not column_groups or x - column_groups[-1][-1] > 6:
                            column_groups.append([x])
                        else:
                            column_groups[-1].append(x)
                    columns = [median(group) for group in column_groups]
                    differences = [b - a for a, b in zip(columns, columns[1:]) if 8 <= b - a <= 25]
                    if not differences and system_step is None or columns[0] - left > (right - left) * .23:
                        continue
                    step = median(differences) if len(differences) >= 2 else system_step
                    if not 10 <= step <= 25:
                        continue
                    measure_index = first_measure + bar_index
                    if measure_index >= len(measures[0]):
                        continue
                    beats = measure_beats(measures[0][:measure_index + 1])
                    slots_count = round(beats * 2)
                    recovered: dict[int, dict[int, list[tuple[str, int, int]]]] = defaultdict(lambda: defaultdict(list))
                    for x, y, staff_index in items:
                        slot = round((x - columns[0]) / step)
                        if not 0 <= slot < slots_count or abs(x - (columns[0] + slot * step)) > 6:
                            continue
                        part_index = part_indices[staff_index]
                        clef, octave_change, fifths = settings[part_index][measure_index]
                        # Audiveris sometimes omits the small "8" below a
                        # tenor G clef. The printed SATB staff order resolves it.
                        if clef == 'G' and ((len(group) == 4 and staff_index == 2) or (len(group) == 8 and staff_index in (4, 5))):
                            octave_change = -1
                        pitch = note_pitch(group[staff_index], y, clef, octave_change, fifths)
                        if pitch not in recovered[part_index][slot]:
                            recovered[part_index][slot].append(pitch)
                    for part_index, slots in recovered.items():
                        measure = measures[part_index][measure_index]
                        divisions = 2
                        for previous in reversed(measures[part_index][:measure_index + 1]):
                            node = previous.find('./attributes/divisions')
                            if node is not None:
                                divisions = int(node.text)
                                break
                        total += insert_crosses(measure, slots, divisions, beats)
        if total:
            ET.indent(score, space='  ')
            source[score_name] = ET.tostring(score, encoding='utf-8', xml_declaration=True)
            with ZipFile(output, 'w') as archive:
                for name, body in source.items():
                    archive.writestr(name, body)
        return total


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf', type=Path)
    parser.add_argument('mxl', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(recover(args.pdf, args.mxl, args.output))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
