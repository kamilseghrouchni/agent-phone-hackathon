#!/usr/bin/env python3
"""
md_to_notion.py — Convert markdown text to Notion API block format.

Usage:
  python3 md_to_notion.py <markdown_file> [--page-id <id>] [--post]
  echo "# Hello" | python3 md_to_notion.py - [--page-id <id>] [--post]

Without --post: prints JSON blocks to stdout (for inspection or piping).
With --post --page-id <id>: appends blocks directly to the Notion page.

Supported markdown:
  # Heading 1
  ## Heading 2
  ### Heading 3
  - Bullet item
  * Bullet item
  1. Numbered item
  2. Numbered item
  - [ ] Unchecked todo
  - [x] Checked todo
  --- or *** (divider)
  > Blockquote (rendered as callout)
  ```lang (code block)
  Regular paragraph text

  Inline: **bold**, *italic*, `code`, [link text](url)
  
  Extended syntax:
  :::toggle Title    (collapsible toggle block)
  :::                (end toggle)
  [bookmark](url)    (bookmark embed, alone on a line)
  !toc               (table of contents)

Token: reads from .notion-token in workspace root or NOTION_TOKEN env var.
"""

import json
import sys
import os
import re
import urllib.request


def find_token():
    """Find Notion token from file or env."""
    # Try workspace .notion-token
    for path in [
        os.path.join(os.path.dirname(__file__), "../../../.notion-token"),
        os.path.expanduser("~/.openclaw/workspace/.notion-token"),
    ]:
        if os.path.exists(path):
            return open(path).read().strip()
    return os.environ.get("NOTION_TOKEN", "")


def parse_rich_text(text):
    """Parse markdown inline formatting into Notion rich_text array."""
    segments = []
    # Pattern: ***bold+italic***, **bold**, *italic*, `code`, [text](url)
    pattern = (
        r'(\*\*\*(.+?)\*\*\*'        # ***bold+italic***
        r'|\*\*(.+?)\*\*'             # **bold**
        r'|\*(.+?)\*'                 # *italic*
        r'|`([^`]+)`'                 # `code`
        r'|\[([^\]]+)\]\(([^)]+)\)'   # [text](url)
        r')'
    )
    
    last_end = 0
    for match in re.finditer(pattern, text):
        # Add plain text before this match
        if match.start() > last_end:
            plain = text[last_end:match.start()]
            if plain:
                segments.append({"type": "text", "text": {"content": plain}})
        
        if match.group(2):  # ***bold+italic***
            segments.append({
                "type": "text",
                "text": {"content": match.group(2)},
                "annotations": {"bold": True, "italic": True}
            })
        elif match.group(3):  # **bold**
            segments.append({
                "type": "text",
                "text": {"content": match.group(3)},
                "annotations": {"bold": True}
            })
        elif match.group(4):  # *italic*
            segments.append({
                "type": "text",
                "text": {"content": match.group(4)},
                "annotations": {"italic": True}
            })
        elif match.group(5):  # `code`
            segments.append({
                "type": "text",
                "text": {"content": match.group(5)},
                "annotations": {"code": True}
            })
        elif match.group(6) and match.group(7):  # [text](url)
            segments.append({
                "type": "text",
                "text": {"content": match.group(6), "link": {"url": match.group(7)}}
            })
        
        last_end = match.end()
    
    # Add remaining plain text
    if last_end < len(text):
        remaining = text[last_end:]
        if remaining:
            segments.append({"type": "text", "text": {"content": remaining}})
    
    # If no formatting found, return simple text
    if not segments:
        segments = [{"type": "text", "text": {"content": text}}]
    
    return segments


def md_to_blocks(markdown_text):
    """Convert markdown string to list of Notion blocks."""
    blocks = []
    lines = markdown_text.split("\n")
    i = 0
    
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        # Skip empty lines
        if not stripped:
            i += 1
            continue
        
        # Markdown table
        if stripped.startswith("|") and stripped.endswith("|"):
            # Collect all table lines
            table_lines = [stripped]
            i += 1
            while i < len(lines):
                tl = lines[i].strip()
                if tl.startswith("|") and tl.endswith("|"):
                    table_lines.append(tl)
                    i += 1
                else:
                    break
            
            # Parse table
            rows = []
            for tl in table_lines:
                cells = [c.strip() for c in tl.strip("|").split("|")]
                # Skip separator rows (|---|---|)
                if all(c.replace("-", "").replace(":", "").strip() == "" for c in cells):
                    continue
                rows.append(cells)
            
            if rows:
                n_cols = max(len(r) for r in rows)
                # Pad rows to same column count
                for r in rows:
                    while len(r) < n_cols:
                        r.append("")
                
                has_header = len(rows) > 1
                table_block = {
                    "object": "block",
                    "type": "table",
                    "table": {
                        "table_width": n_cols,
                        "has_column_header": has_header,
                        "has_row_header": False,
                        "children": []
                    }
                }
                
                for row in rows:
                    table_row = {
                        "object": "block",
                        "type": "table_row",
                        "table_row": {
                            "cells": [
                                parse_rich_text(cell) for cell in row
                            ]
                        }
                    }
                    table_block["table"]["children"].append(table_row)
                
                blocks.append(table_block)
            continue
        
        # Table of contents
        if stripped == "!toc":
            blocks.append({"object": "block", "type": "table_of_contents", "table_of_contents": {}})
            i += 1
            continue
        
        # Divider
        if stripped in ("---", "***", "___") or re.match(r'^-{3,}$', stripped) or re.match(r'^\*{3,}$', stripped):
            blocks.append({"object": "block", "type": "divider", "divider": {}})
            i += 1
            continue
        
        # Code block
        if stripped.startswith("```"):
            lang = stripped[3:].strip() or "plain text"
            code_lines = []
            i += 1
            while i < len(lines):
                if lines[i].strip().startswith("```"):
                    i += 1
                    break
                code_lines.append(lines[i])
                i += 1
            code_text = "\n".join(code_lines)
            # Notion code block limit is 2000 chars
            if len(code_text) > 2000:
                code_text = code_text[:2000]
            blocks.append({
                "object": "block",
                "type": "code",
                "code": {
                    "rich_text": [{"type": "text", "text": {"content": code_text}}],
                    "language": lang
                }
            })
            continue
        
        # Toggle block (:::toggle Title ... :::)
        if stripped.startswith(":::toggle "):
            title = stripped[10:]
            toggle_children = []
            i += 1
            # Collect lines until closing :::
            child_lines = []
            while i < len(lines):
                if lines[i].strip() == ":::":
                    i += 1
                    break
                child_lines.append(lines[i])
                i += 1
            # Recursively parse children
            if child_lines:
                child_md = "\n".join(child_lines)
                toggle_children = md_to_blocks(child_md)
            
            rt = parse_rich_text(title)
            block = {
                "object": "block",
                "type": "toggle",
                "toggle": {"rich_text": rt}
            }
            if toggle_children:
                block["toggle"]["children"] = toggle_children
            blocks.append(block)
            continue
        
        # Bookmark (standalone link on its own line)
        bookmark_match = re.match(r'^\[bookmark\]\((.+)\)$', stripped)
        if bookmark_match:
            blocks.append({
                "object": "block",
                "type": "bookmark",
                "bookmark": {"url": bookmark_match.group(1)}
            })
            i += 1
            continue
        
        # Headings
        if stripped.startswith("### "):
            text = stripped[4:]
            rt = parse_rich_text(text)
            # Notion limits rich_text content to 2000 chars
            for seg in rt:
                if len(seg["text"]["content"]) > 2000:
                    seg["text"]["content"] = seg["text"]["content"][:2000]
            blocks.append({"object": "block", "type": "heading_3", "heading_3": {"rich_text": rt}})
            i += 1
            continue
        
        if stripped.startswith("## "):
            text = stripped[3:]
            rt = parse_rich_text(text)
            for seg in rt:
                if len(seg["text"]["content"]) > 2000:
                    seg["text"]["content"] = seg["text"]["content"][:2000]
            blocks.append({"object": "block", "type": "heading_2", "heading_2": {"rich_text": rt}})
            i += 1
            continue
        
        if stripped.startswith("# "):
            text = stripped[2:]
            rt = parse_rich_text(text)
            for seg in rt:
                if len(seg["text"]["content"]) > 2000:
                    seg["text"]["content"] = seg["text"]["content"][:2000]
            blocks.append({"object": "block", "type": "heading_1", "heading_1": {"rich_text": rt}})
            i += 1
            continue
        
        # Todo items
        todo_match = re.match(r'^- \[([ x])\] (.+)$', stripped)
        if todo_match:
            checked = todo_match.group(1) == "x"
            text = todo_match.group(2)
            rt = parse_rich_text(text)
            for seg in rt:
                if len(seg["text"]["content"]) > 2000:
                    seg["text"]["content"] = seg["text"]["content"][:2000]
            blocks.append({
                "object": "block",
                "type": "to_do",
                "to_do": {"rich_text": rt, "checked": checked}
            })
            i += 1
            continue
        
        # Numbered list items
        numbered_match = re.match(r'^\d+\.\s+(.+)$', stripped)
        if numbered_match:
            text = numbered_match.group(1)
            rt = parse_rich_text(text)
            for seg in rt:
                if len(seg["text"]["content"]) > 2000:
                    seg["text"]["content"] = seg["text"]["content"][:2000]
            blocks.append({
                "object": "block",
                "type": "numbered_list_item",
                "numbered_list_item": {"rich_text": rt}
            })
            i += 1
            continue
        
        # Bullet list items
        if stripped.startswith("- ") or stripped.startswith("* "):
            text = stripped[2:]
            rt = parse_rich_text(text)
            for seg in rt:
                if len(seg["text"]["content"]) > 2000:
                    seg["text"]["content"] = seg["text"]["content"][:2000]
            blocks.append({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {"rich_text": rt}
            })
            i += 1
            continue
        
        # Blockquote / callout
        if stripped.startswith("> "):
            text = stripped[2:]
            rt = parse_rich_text(text)
            for seg in rt:
                if len(seg["text"]["content"]) > 2000:
                    seg["text"]["content"] = seg["text"]["content"][:2000]
            blocks.append({
                "object": "block",
                "type": "callout",
                "callout": {"rich_text": rt, "icon": {"type": "emoji", "emoji": "💡"}}
            })
            i += 1
            continue
        
        # Regular paragraph — collect consecutive non-special lines
        para_lines = [stripped]
        i += 1
        while i < len(lines):
            next_stripped = lines[i].strip()
            if (not next_stripped or 
                next_stripped.startswith("#") or 
                next_stripped.startswith("- ") or 
                next_stripped.startswith("* ") or 
                next_stripped.startswith("> ") or
                next_stripped in ("---", "***", "___")):
                break
            para_lines.append(next_stripped)
            i += 1
        
        text = " ".join(para_lines)
        # Notion paragraph limit is 2000 chars per rich_text segment
        # Split long paragraphs into multiple segments
        rt = parse_rich_text(text)
        
        # Handle segments > 2000 chars by splitting
        final_rt = []
        for seg in rt:
            content = seg["text"]["content"]
            while len(content) > 2000:
                chunk = content[:2000]
                new_seg = dict(seg)
                new_seg["text"] = {"content": chunk}
                final_rt.append(new_seg)
                content = content[2000:]
            if content:
                new_seg = dict(seg)
                new_seg["text"] = {"content": content}
                final_rt.append(new_seg)
        
        blocks.append({"object": "block", "type": "paragraph", "paragraph": {"rich_text": final_rt}})
    
    return blocks


def post_to_notion(blocks, page_id, token):
    """Append blocks to a Notion page. Batches in groups of 100 (API limit)."""
    url = f"https://api.notion.com/v1/blocks/{page_id}/children"
    
    total_posted = 0
    for batch_start in range(0, len(blocks), 100):
        batch = blocks[batch_start:batch_start + 100]
        body = json.dumps({"children": batch}).encode()
        
        req = urllib.request.Request(url, data=body, method="PATCH")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Notion-Version", "2022-06-28")
        req.add_header("Content-Type", "application/json")
        
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())
        posted = len(result.get("results", []))
        total_posted += posted
    
    return total_posted


def main():
    args = sys.argv[1:]
    
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return
    
    # Parse args
    input_file = args[0]
    page_id = None
    do_post = False
    
    i = 1
    while i < len(args):
        if args[i] == "--page-id" and i + 1 < len(args):
            page_id = args[i + 1]; i += 2
        elif args[i] == "--post":
            do_post = True; i += 1
        else:
            i += 1
    
    # Read input
    if input_file == "-":
        markdown = sys.stdin.read()
    else:
        if not os.path.exists(input_file):
            print(f"Error: file not found: {input_file}")
            sys.exit(1)
        markdown = open(input_file).read()
    
    # Convert
    blocks = md_to_blocks(markdown)
    
    if do_post:
        if not page_id:
            print("Error: --page-id required with --post")
            sys.exit(1)
        token = find_token()
        if not token:
            print("Error: no Notion token found")
            sys.exit(1)
        
        posted = post_to_notion(blocks, page_id, token)
        print(f"Posted {posted} blocks to Notion page {page_id}")
    else:
        print(json.dumps(blocks, indent=2))
        print(f"\n# {len(blocks)} blocks generated")


if __name__ == "__main__":
    main()
