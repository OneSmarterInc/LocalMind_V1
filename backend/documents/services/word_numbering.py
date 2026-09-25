"""Resolve Word's numbering metadata without a model or Word installation.

Preserves list instances, starts, restarts, nested labels and inherited numPr.
Supports decimal, decimalZero, alpha, Roman, none and bullet formats. An
unsupported numbering scheme is reported rather than silently made a bullet.
"""
from __future__ import annotations

import re
from xml.etree import ElementTree as ET
from zipfile import ZipFile

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _val(parent, name, default=None):
    node = parent.find(f"{W}{name}") if parent is not None else None
    return node.get(f"{W}val", default) if node is not None else default


def _integer(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def format_counter(number: int, kind: str) -> str:
    if kind in ("decimal", "decimalZero"):
        return str(number).zfill(2) if kind == "decimalZero" else str(number)
    if kind in ("lowerLetter", "upperLetter") and number > 0:
        text = ""
        while number:
            number, digit = divmod(number - 1, 26)
            text = chr(65 + digit) + text
        return text.lower() if kind == "lowerLetter" else text
    if kind in ("lowerRoman", "upperRoman") and 0 < number < 4000:
        text = ""
        for value, letters in ((1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
                               (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
                               (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
            count, number = divmod(number, value)
            text += letters * count
        return text.lower() if kind == "lowerRoman" else text
    if kind == "none":
        return ""
    raise ValueError(f"Unsupported Word numbering format {kind!r} for {number}. Export the document as PDF or use decimal list numbering.")


class WordNumbering:
    def __init__(self, archive: ZipFile):
        self.abstract: dict[str, ET.Element] = {}
        self.instances: dict[str, ET.Element] = {}
        self.styles: dict[str, ET.Element] = {}
        self.counters: dict[tuple[str, int], int] = {}
        self.level_cache: dict[str, dict[int, dict]] = {}
        for path, target, tag, key in (
            ("word/numbering.xml", self.abstract, "abstractNum", "abstractNumId"),
            ("word/numbering.xml", self.instances, "num", "numId"),
            ("word/styles.xml", self.styles, "style", "styleId"),
        ):
            try:
                root = ET.fromstring(archive.read(path))
            except KeyError:
                continue
            for element in root.findall(f"{W}{tag}"):
                ident = element.get(f"{W}{key}")
                if ident is not None:
                    target[ident] = element

    def _style_props(self, ident: str | None, seen=None) -> dict:
        seen = set(seen or ())
        if not ident or ident in seen or ident not in self.styles:
            return {}
        seen.add(ident)
        style = self.styles[ident]
        props = self._style_props(_val(style, "basedOn"), seen)
        props.update(self._props(style.find(f"{W}pPr")))
        return props

    @staticmethod
    def _props(ppr) -> dict:
        num = ppr.find(f"{W}numPr") if ppr is not None else None
        return {k: v for k in ("numId", "ilvl") if (v := _val(num, k)) is not None}

    @staticmethod
    def _level(node, base=None):
        props = dict(base or {})
        for name in ("start", "numFmt", "lvlText", "lvlRestart"):
            value = _val(node, name)
            if value is not None:
                props[name] = value
        return props

    def _levels(self, num_id: str, seen=None) -> dict[int, dict]:
        if num_id in self.level_cache:
            return self.level_cache[num_id]
        seen = set(seen or ())
        if num_id in seen or num_id not in self.instances:
            raise ValueError(f"Word list {num_id} has missing or cyclic numbering metadata.")
        seen.add(num_id)
        instance = self.instances[num_id]
        abstract = self.abstract.get(_val(instance, "abstractNumId"))
        if abstract is None:
            raise ValueError(f"Word list {num_id} has no abstract numbering definition.")
        levels = {}
        linked_style = _val(abstract, "numStyleLink")
        if linked_style:
            linked = self._style_props(linked_style).get("numId")
            if linked:
                levels.update({k: dict(v) for k, v in self._levels(linked, seen).items()})
        for lvl in abstract.findall(f"{W}lvl"):
            i = _integer(lvl.get(f"{W}ilvl"))
            levels[i] = self._level(lvl, levels.get(i))
        for override in instance.findall(f"{W}lvlOverride"):
            i = _integer(override.get(f"{W}ilvl"))
            props = self._level(override.find(f"{W}lvl"), levels.get(i))
            start = _val(override, "startOverride")
            if start is not None:
                props["start"] = start
            levels[i] = props
        self.level_cache[num_id] = levels
        return levels

    def prefix(self, paragraph) -> str | None:
        ppr = paragraph.find(f"{W}pPr")
        props = self._style_props(_val(ppr, "pStyle"))
        props.update(self._props(ppr))
        num_id = props.get("numId")
        if not num_id or num_id == "0":
            return None
        level = _integer(props.get("ilvl"))
        if not 0 <= level <= 8:
            raise ValueError("Word list nesting must be between zero and eight.")
        levels = self._levels(num_id)
        if level not in levels:
            raise ValueError(f"Word list {num_id} has no definition for level {level}.")
        definition = levels[level]
        key = (num_id, level)
        self.counters[key] = self.counters.get(key, _integer(definition.get("start"), 1) - 1) + 1
        # lvlRestart is one-based; 0 explicitly means never restart.
        for deeper, child in levels.items():
            restart = _integer(child.get("lvlRestart"), deeper)
            if deeper > level and restart and level < restart:
                self.counters.pop((num_id, deeper), None)
        fmt = definition.get("numFmt", "decimal")
        indent = "  " * level
        if fmt == "bullet":
            return indent + "- "
        pattern = definition.get("lvlText", f"%{level + 1}.")
        def substitute(match):
            at = int(match.group(1)) - 1
            if at not in levels:
                raise ValueError("Word list label refers to a missing numbering level.")
            value = self.counters.get((num_id, at), _integer(levels[at].get("start"), 1))
            return format_counter(value, levels[at].get("numFmt", "decimal"))
        if fmt == "none":
            return indent
        # Even a constant label must not silently hide an unsupported format.
        format_counter(self.counters[key], fmt)
        return indent + re.sub(r"%([1-9])", substitute, pattern) + " "
