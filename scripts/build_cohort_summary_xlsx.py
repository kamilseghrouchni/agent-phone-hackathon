#!/usr/bin/env python3
"""Build a tiny valid .xlsx fixture for the email demo (no third-party deps).

Output: public/audit-demo/pd-age-over-75-cohort-summary.xlsx
"""
import os
import zipfile
import xml.sax.saxutils as sx

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "audit-demo",
                    "pd-age-over-75-cohort-summary.xlsx")

# Three sheets (one xlsx-tab each) of summary numbers shown in the email.
SHEETS = [
    ("Headline", [
        ["Field", "Value", "Source"],
        ["Buyer query", "Parkinson's age 75+ · serum + PBMC · multi-visit", "landing form"],
        ["Indication", "Parkinson's disease (PD)", "parser"],
        ["Age floor", "≥ 75", "parser"],
        ["Min N (donors)", "30", "bundle spec"],
        ["Collection window", "≥ 2020 (preferred)", "bundle spec"],
        ["In-bank donors at 75+ with serum + PBMC", "248", "specimens.db"],
        ["Multi-visit subset (≥ 2 distinct years)", "20", "specimens.db"],
        ["Total PD specimens at 75+", "6832", "specimens.db"],
        ["Path chosen", "A — single leg, relax longitudinal", "audit decision"],
        ["Provider — biobank", "Neuro C-BIG (McGill)", "audit"],
        ["Provider — assay", "Metabolon HD4", "audit"],
        ["Negotiated quote (USD)", "168556", "providers"],
        ["Earliest data delivery", "2026-12-08", "providers"],
    ]),
    ("Specimens (2020+)", [
        ["Specimen type", "Aliquots"],
        ["Serum",  "1671"],
        ["PBMC",   "967"],
        ["Plasma", "397"],
        ["DNA",    "294"],
        ["RNA",    "16"],
        ["iPSC",   "17"],
    ]),
    ("Quote", [
        ["Provider", "Line item", "Qty", "Unit", "Unit price USD", "Amount USD"],
        ["Neuro C-BIG", "Access committee + DUA review",    "1",   "fee",      "4500", "4500"],
        ["Neuro C-BIG", "Serum aliquots (248 donors × 2 visits avg)", "496", "aliquot", "22", "10912"],
        ["Neuro C-BIG", "PBMC aliquots (248 donors)",        "248", "aliquot",  "28",  "6944"],
        ["Neuro C-BIG", "DNA aliquots (genotyping arm)",     "248", "aliquot",  "30",  "7440"],
        ["Neuro C-BIG", "Per-donor reserve commitment",      "1",   "fee",      "1500", "1500"],
        ["Neuro C-BIG", "Cold-chain shipping",                "1",   "shipment", "1800", "1800"],
        ["Neuro C-BIG", "PBMC viability pre-ship test",       "1",   "fee",      "2200", "2200"],
        ["Metabolon",   "HD4 untargeted metabolomics (248 serum)", "248", "sample", "395", "97960"],
        ["Metabolon",   "Tube-type bridge sub-study",         "10",  "sample",   "410", "4100"],
        ["Metabolon",   "Cohort comparability statistical report", "1", "report", "12000", "12000"],
        ["Metabolon",   "QC + batch-effect package",          "1",   "report",   "3500", "3500"],
        ["Metabolon",   "Inbound cold-chain receiving + intake", "1", "fee",     "1200", "1200"],
        ["Crovi",       "Coordination + agent dispatch",      "1",   "fee",      "14500", "14500"],
        ["",            "Grand total",                          "",   "",         "",      "168556"],
    ]),
]


def col_letter(n: int) -> str:
    """1 -> A, 27 -> AA. We won't go past Z in this fixture but be safe."""
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(ord("A") + r) + s
    return s


def build_xlsx(sheets, out_path: str) -> None:
    # Shared strings table
    sst: list[str] = []
    sst_idx: dict[str, int] = {}

    def intern(val: str) -> int:
        if val not in sst_idx:
            sst_idx[val] = len(sst)
            sst.append(val)
        return sst_idx[val]

    # Build worksheet XML for each tab (using shared strings + style 1 on header row).
    sheet_xmls: list[str] = []
    for _, rows in sheets:
        cells_xml: list[str] = []
        for r, row in enumerate(rows, 1):
            cs: list[str] = []
            for c, val in enumerate(row, 1):
                ref = f"{col_letter(c)}{r}"
                idx = intern(str(val))
                style = ' s="1"' if r == 1 else ""
                cs.append(f'<c r="{ref}" t="s"{style}><v>{idx}</v></c>')
            cells_xml.append(f'<row r="{r}">{"".join(cs)}</row>')
        sheet_xmls.append(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f'<sheetData>{"".join(cells_xml)}</sheetData></worksheet>'
        )

    # workbook.xml lists the sheets, each with a relationship id.
    sheets_xml = "".join(
        f'<sheet name="{sx.escape(name)}" sheetId="{i+1}" r:id="rId{i+1}"/>'
        for i, (name, _) in enumerate(sheets)
    )
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets>{sheets_xml}</sheets></workbook>'
    )

    # Workbook relationships → worksheets + sharedStrings + styles.
    rels_parts: list[str] = []
    for i, _ in enumerate(sheets):
        rels_parts.append(
            f'<Relationship Id="rId{i+1}"'
            ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
            f' Target="worksheets/sheet{i+1}.xml"/>'
        )
    n = len(sheets)
    rels_parts.append(
        f'<Relationship Id="rId{n+1}"'
        ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"'
        ' Target="sharedStrings.xml"/>'
    )
    rels_parts.append(
        f'<Relationship Id="rId{n+2}"'
        ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"'
        ' Target="styles.xml"/>'
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'{"".join(rels_parts)}</Relationships>'
    )

    # Shared strings.
    sst_items = "".join(
        f'<si><t xml:space="preserve">{sx.escape(s)}</t></si>' for s in sst
    )
    sst_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        f' count="{len(sst)}" uniqueCount="{len(sst)}">{sst_items}</sst>'
    )

    # Two-cell-style stylesheet: default + bold header.
    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2">'
        '<font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font>'
        '</fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border/></borders>'
        '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
        '<cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs>'
        '</styleSheet>'
    )

    # Top-level package files.
    overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{i+1}.xml"'
        ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for i in range(len(sheets))
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml"'
        ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        f'{overrides}'
        '<Override PartName="/xl/sharedStrings.xml"'
        ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        '<Override PartName="/xl/styles.xml"'
        ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1"'
        ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
        ' Target="xl/workbook.xml"/>'
        '</Relationships>'
    )

    out_dir = os.path.dirname(out_path)
    os.makedirs(out_dir, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook_xml)
        z.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        for i, xml in enumerate(sheet_xmls):
            z.writestr(f"xl/worksheets/sheet{i+1}.xml", xml)
        z.writestr("xl/sharedStrings.xml", sst_xml)
        z.writestr("xl/styles.xml", styles_xml)


if __name__ == "__main__":
    build_xlsx(SHEETS, OUT)
    print(f"wrote {OUT}")
