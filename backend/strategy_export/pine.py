from __future__ import annotations

import re

from backend.strategy_export.spec import Indicator, Operand, Rule, StrategySpec


def to_pine(spec: StrategySpec) -> tuple[str, list[str]]:
    """Render a strategy spec as TradingView Pine Script v6."""
    warnings: list[str] = []
    lines = [
        "//@version=6",
        f'strategy("{_quote(spec.name)}", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value={_num(spec.risk.qty_pct)})',
        "",
    ]
    rendered: set[str] = set()
    unsupported: set[str] = set()
    for indicator in spec.indicators:
        code = _indicator_line(indicator)
        if code is None:
            warnings.append(f"Unsupported indicator type {indicator.type!r} for {indicator.id}; related rules skipped")
            unsupported.add(indicator.id)
            continue
        lines.append(code)
        rendered.add(indicator.id)

    lines.append("")
    long_entry = _rules_expr(spec.entry_long, rendered, unsupported, warnings)
    short_entry = _rules_expr(spec.entry_short, rendered, unsupported, warnings)
    long_exit = _rules_expr(spec.exit_long, rendered, unsupported, warnings)
    short_exit = _rules_expr(spec.exit_short, rendered, unsupported, warnings)

    # Pine v6 removed the `when=` argument from strategy.* calls; gate with `if`.
    if long_entry:
        lines.append(f'if {long_entry}\n    strategy.entry("Long", strategy.long)')
    if short_entry:
        lines.append(f'if {short_entry}\n    strategy.entry("Short", strategy.short)')
    if long_exit:
        lines.append(f'if {long_exit}\n    strategy.close("Long")')
    if short_exit:
        lines.append(f'if {short_exit}\n    strategy.close("Short")')

    stop_pct = spec.risk.stop_pct
    take_pct = spec.risk.take_pct
    if stop_pct is not None or take_pct is not None:
        long_stop = f"strategy.position_avg_price * (1 - {_num(stop_pct or 0)} / 100)" if stop_pct is not None else "na"
        long_take = f"strategy.position_avg_price * (1 + {_num(take_pct or 0)} / 100)" if take_pct is not None else "na"
        short_stop = f"strategy.position_avg_price * (1 + {_num(stop_pct or 0)} / 100)" if stop_pct is not None else "na"
        short_take = f"strategy.position_avg_price * (1 - {_num(take_pct or 0)} / 100)" if take_pct is not None else "na"
        lines.extend(
            [
                f'strategy.exit("Long Risk", from_entry="Long", stop={long_stop}, limit={long_take})',
                f'strategy.exit("Short Risk", from_entry="Short", stop={short_stop}, limit={short_take})',
            ]
        )

    return "\n".join(lines).rstrip() + "\n", warnings


def _indicator_line(indicator: Indicator) -> str | None:
    name = _ident(indicator.id)
    source = _price(indicator.source)
    length = int(indicator.params.get("length", 14))
    if indicator.type == "sma":
        return f"{name} = ta.sma({source}, {length})"
    if indicator.type == "ema":
        return f"{name} = ta.ema({source}, {length})"
    if indicator.type == "rsi":
        return f"{name} = ta.rsi({source}, {length})"
    if indicator.type == "macd":
        fast = int(indicator.params.get("fast", 12))
        slow = int(indicator.params.get("slow", 26))
        signal = int(indicator.params.get("signal", 9))
        component = str(indicator.params.get("component", "line"))
        index = {"line": "macd", "signal": "signal", "hist": "hist"}.get(component, "macd")
        return f"[{name}_macd, {name}_signal, {name}_hist] = ta.macd({source}, {fast}, {slow}, {signal})\n{name} = {name}_{index}"
    if indicator.type == "bbands":
        mult = float(indicator.params.get("mult", 2))
        component = str(indicator.params.get("component", "basis"))
        index = {"basis": "basis", "upper": "upper", "lower": "lower"}.get(component, "basis")
        return f"[{name}_basis, {name}_upper, {name}_lower] = ta.bb({source}, {length}, {_num(mult)})\n{name} = {name}_{index}"
    if indicator.type == "atr":
        return f"{name} = ta.atr({length})"
    if indicator.type == "stdev":
        return f"{name} = ta.stdev({source}, {length})"
    if indicator.type == "highest":
        return f"{name} = ta.highest({source}, {length})"
    if indicator.type == "lowest":
        return f"{name} = ta.lowest({source}, {length})"
    return None


def _rules_expr(rules: list[Rule], rendered: set[str], unsupported: set[str], warnings: list[str]) -> str:
    parts: list[str] = []
    for rule in rules:
        refs = _rule_indicator_refs(rule)
        skipped = refs - rendered
        if skipped:
            if skipped & unsupported:
                warnings.append(f"Skipped rule referencing unsupported indicator(s): {', '.join(sorted(skipped))}")
                continue
            warnings.append(f"Skipped rule referencing unavailable indicator(s): {', '.join(sorted(skipped))}")
            continue
        parts.append(_rule_expr(rule))
    return " and ".join(f"({part})" for part in parts)


def _rule_expr(rule: Rule) -> str:
    left = _operand(rule.left)
    if rule.op == "rising":
        return f"{left} > {left}[1]"
    if rule.op == "falling":
        return f"{left} < {left}[1]"
    right = _operand(rule.right) if rule.right else "na"
    if rule.op == "cross_above":
        return f"ta.crossover({left}, {right})"
    if rule.op == "cross_below":
        return f"ta.crossunder({left}, {right})"
    return f"{left} {rule.op} {right}"


def _rule_indicator_refs(rule: Rule) -> set[str]:
    refs = set()
    for operand in (rule.left, rule.right):
        if operand and operand.kind == "indicator":
            refs.add(operand.ref)
    return refs


def _operand(operand: Operand | None) -> str:
    if operand is None:
        return "na"
    if operand.kind == "indicator":
        return _ident(operand.ref)
    if operand.kind == "price":
        return _price(operand.ref)
    return _num(operand.value or 0)


def _price(ref: str) -> str:
    if ref == "hl2":
        return "hl2"
    if ref == "hlc3":
        return "hlc3"
    return ref


def _ident(value: str) -> str:
    ident = re.sub(r"\W+", "_", value.strip())
    if not ident or ident[0].isdigit():
        ident = f"i_{ident}"
    return ident


def _quote(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _num(value: float | int) -> str:
    number = float(value)
    return str(int(number)) if number.is_integer() else str(number)
