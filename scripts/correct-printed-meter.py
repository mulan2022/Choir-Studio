"""Correct time signatures in the experimental 蒲公英 MusicXML from the printed PDF."""

from pathlib import Path
from xml.etree import ElementTree as ET

source = Path('exports/蒲公英-homr补全延音实验版.musicxml')
target = Path('exports/蒲公英-校正拍号与延音.musicxml')

# These changes are visible on the printed pages 6, 7, 11 and 12.
changes = {
    1: (6, 8), 55: (4, 4), 56: (1, 4), 57: (4, 4),
    58: (1, 4), 59: (4, 4), 60: (2, 4), 61: (4, 4),
    67: (2, 4), 68: (6, 8), 109: (4, 4), 110: (1, 4),
    111: (4, 4), 112: (2, 4), 113: (4, 4), 114: (3, 4),
    116: (4, 4), 118: (2, 4), 119: (4, 4), 120: (2, 4),
    121: (4, 4), 122: (3, 4), 123: (4, 4),
}

tree = ET.parse(source)
root = tree.getroot()
for part in root.findall('part'):
    measures = part.findall('measure')
    for index, measure in enumerate(measures, 1):
        for attributes in measure.findall('attributes'):
            time = attributes.find('time')
            if time is not None:
                attributes.remove(time)
        if index not in changes:
            continue
        attributes = measure.find('attributes')
        if attributes is None:
            attributes = ET.Element('attributes')
            measure.insert(0, attributes)
        time = ET.Element('time')
        ET.SubElement(time, 'beats').text = str(changes[index][0])
        ET.SubElement(time, 'beat-type').text = str(changes[index][1])
        attributes.insert(0, time)

ET.indent(tree, space='  ')
tree.write(target, encoding='utf-8', xml_declaration=True)
print(target)
