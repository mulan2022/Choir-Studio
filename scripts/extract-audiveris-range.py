from __future__ import annotations

import argparse
import copy
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET


def local_name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def read_root(path: Path) -> ET.Element:
    if path.suffix.lower() != ".mxl":
        return ET.parse(path).getroot()
    with zipfile.ZipFile(path) as archive:
        name = next(
            item
            for item in archive.namelist()
            if item.lower().endswith(".xml") and not item.startswith("META-INF/")
        )
        return ET.fromstring(archive.read(name))


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract a five-part page range from Audiveris MusicXML.")
    parser.add_argument("input")
    parser.add_argument("start", type=int)
    parser.add_argument("end", type=int)
    parser.add_argument("-o", "--output", required=True)
    args = parser.parse_args()

    source = read_root(Path(args.input))
    source_parts = {part.get("id"): part for part in source if local_name(part) == "part"}
    mapping = [("P3", "Soprano"), ("P4", "Alto"), ("P5", "Tenor"), ("P6", "Bass"), ("P7", "Piano")]
    missing = [part_id for part_id, _ in mapping if part_id not in source_parts]
    if missing:
        raise ValueError(f"Audiveris parts missing: {', '.join(missing)}")

    result = ET.Element("score-partwise", {"version": "4.0"})
    part_list = ET.SubElement(result, "part-list")
    for index, (_, name) in enumerate(mapping, 1):
        definition = ET.SubElement(part_list, "score-part", {"id": f"P{index}"})
        ET.SubElement(definition, "part-name").text = name

    for index, (source_id, _) in enumerate(mapping, 1):
        part = ET.SubElement(result, "part", {"id": f"P{index}"})
        measures = [item for item in source_parts[source_id] if local_name(item) == "measure"]
        if len(measures) < args.end:
            raise ValueError(f"{source_id} has only {len(measures)} measures")
        for number, measure in enumerate(measures[args.start - 1 : args.end], 1):
            cloned = copy.deepcopy(measure)
            cloned.set("number", str(number))
            part.append(cloned)

    ET.indent(result, space="  ")
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(result).write(destination, encoding="utf-8", xml_declaration=True)
    print(f"Wrote {destination}: measures {args.start}-{args.end}")


if __name__ == "__main__":
    main()
