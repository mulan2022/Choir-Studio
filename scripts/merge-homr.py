from __future__ import annotations

import argparse
import copy
from pathlib import Path
import xml.etree.ElementTree as ET


def local_name(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def direct_children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if local_name(child) == name]


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge homr's per-page MusicXML files.")
    parser.add_argument("inputs", nargs="+")
    parser.add_argument("-o", "--output", required=True)
    parser.add_argument("--title", default="")
    args = parser.parse_args()

    roots = [ET.parse(path).getroot() for path in args.inputs]
    output_root = copy.deepcopy(roots[0])
    output_parts = direct_children(output_root, "part")
    if not output_parts:
        raise ValueError("The first MusicXML file has no parts.")
    for part in output_parts:
        for measure in direct_children(part, "measure"):
            part.remove(measure)

    next_measure = 1
    for source_root in roots:
        source_parts = direct_children(source_root, "part")
        if len(source_parts) != len(output_parts):
            raise ValueError(
                f"Part count changed from {len(output_parts)} to {len(source_parts)}"
            )
        page_measures = [direct_children(part, "measure") for part in source_parts]
        page_count = max(map(len, page_measures), default=0)
        for part_index, target_part in enumerate(output_parts):
            for index in range(page_count):
                if index < len(page_measures[part_index]):
                    measure = copy.deepcopy(page_measures[part_index][index])
                else:
                    # Preserve cross-part measure alignment if homr drops an
                    # empty staff measure. Other parts still define its length.
                    measure = ET.Element("measure")
                measure.set("number", str(next_measure + index))
                target_part.append(measure)
        next_measure += page_count

    if args.title:
        work = next((item for item in output_root if local_name(item) == "work"), None)
        if work is None:
            work = ET.Element("work")
            output_root.insert(0, work)
        title = next((item for item in work if local_name(item) == "work-title"), None)
        if title is None:
            title = ET.SubElement(work, "work-title")
        title.text = args.title

    ET.indent(output_root, space="  ")
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(output_root).write(destination, encoding="utf-8", xml_declaration=True)
    print(f"Wrote {destination} with {next_measure - 1} measures and {len(output_parts)} parts")


if __name__ == "__main__":
    main()
