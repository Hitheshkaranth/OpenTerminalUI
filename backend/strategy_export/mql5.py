from __future__ import annotations

import re

from backend.strategy_export.spec import Indicator, Operand, Rule, StrategySpec


def to_mql5(spec: StrategySpec) -> tuple[str, list[str]]:
    """Render a strategy spec as a MetaTrader 5 Expert Advisor skeleton."""
    warnings: list[str] = []
    rendered: set[str] = set()
    unsupported: set[str] = set()
    handle_lines: list[str] = []
    init_lines: list[str] = []
    copy_lines: list[str] = []

    for indicator in spec.indicators:
        handle = _handle(indicator.id)
        buf = _buf(indicator.id)
        if indicator.type in {"highest", "lowest"}:
            copy_lines.extend(_channel_copy_lines(indicator))
            rendered.add(indicator.id)
            continue
        setup = _indicator_setup(indicator)
        if setup is None:
            warnings.append(f"Unsupported indicator type {indicator.type!r} for {indicator.id}; related rules skipped")
            unsupported.add(indicator.id)
            continue
        handle_lines.append(f"int {handle} = INVALID_HANDLE;")
        init_lines.append(f"   {handle} = {setup};")
        init_lines.append(f"   if({handle} == INVALID_HANDLE) return INIT_FAILED;")
        copy_lines.append(f"   double {buf}[3]; ArraySetAsSeries({buf}, true);")
        copy_lines.append(f"   if(CopyBuffer({handle}, {_buffer_index(indicator)}, 0, 3, {buf}) < 3) return;")
        rendered.add(indicator.id)

    if rendered and not any(indicator.id in rendered and indicator.type not in {"highest", "lowest"} for indicator in spec.indicators):
        init_lines.append("   int compatibilityHandle = iATR(_Symbol, _Period, 14);")
        init_lines.append("   if(compatibilityHandle != INVALID_HANDLE) IndicatorRelease(compatibilityHandle);")

    long_entry = _rules_expr(spec.entry_long, rendered, unsupported, warnings)
    short_entry = _rules_expr(spec.entry_short, rendered, unsupported, warnings)
    long_exit = _rules_expr(spec.exit_long, rendered, unsupported, warnings)
    short_exit = _rules_expr(spec.exit_short, rendered, unsupported, warnings)

    lines = [
        "#property strict",
        f'#property description "{_quote(spec.name)}"',
        "#include <Trade/Trade.mqh>",
        "",
        "CTrade trade;",
        "input double InpLots = 0.10;",
        f"input double InpStopPct = {_num(spec.risk.stop_pct or 0)};",
        f"input double InpTakePct = {_num(spec.risk.take_pct or 0)};",
        "",
        *handle_lines,
        "",
        "int OnInit()",
        "{",
        *init_lines,
        "   return INIT_SUCCEEDED;",
        "}",
        "",
        "void OnDeinit(const int reason)",
        "{",
    ]
    for indicator in spec.indicators:
        # highest/lowest are computed inline (iHighest/iLowest) and never declare a handle;
        # releasing one would reference an undeclared identifier and fail to compile.
        if indicator.id in rendered and indicator.type not in {"highest", "lowest"}:
            lines.append(f"   IndicatorRelease({_handle(indicator.id)});")
    lines.extend(
        [
            "}",
            "",
            "void OnTick()",
            "{",
            "   MqlTick tick;",
            "   if(!SymbolInfoTick(_Symbol, tick)) return;",
            *copy_lines,
            f"   bool longEntry = {_bool_expr(long_entry)};",
            f"   bool shortEntry = {_bool_expr(short_entry)};",
            f"   bool longExit = {_bool_expr(long_exit)};",
            f"   bool shortExit = {_bool_expr(short_exit)};",
            "   bool hasPosition = PositionSelect(_Symbol);",
            "   long posType = hasPosition ? PositionGetInteger(POSITION_TYPE) : -1;",
            "   if(hasPosition && posType == POSITION_TYPE_BUY && longExit) trade.PositionClose(_Symbol);",
            "   if(hasPosition && posType == POSITION_TYPE_SELL && shortExit) trade.PositionClose(_Symbol);",
            "   if(!PositionSelect(_Symbol) && longEntry)",
            "   {",
            "      double sl = InpStopPct > 0 ? tick.ask * (1.0 - InpStopPct / 100.0) : 0.0;",
            "      double tp = InpTakePct > 0 ? tick.ask * (1.0 + InpTakePct / 100.0) : 0.0;",
            '      trade.Buy(InpLots, _Symbol, tick.ask, sl, tp, "Long");',
            "   }",
            "   if(!PositionSelect(_Symbol) && shortEntry)",
            "   {",
            "      double sl = InpStopPct > 0 ? tick.bid * (1.0 + InpStopPct / 100.0) : 0.0;",
            "      double tp = InpTakePct > 0 ? tick.bid * (1.0 - InpTakePct / 100.0) : 0.0;",
            '      trade.Sell(InpLots, _Symbol, tick.bid, sl, tp, "Short");',
            "   }",
            "}",
            "",
            "double PriceValue(const string name, const int shift)",
            "{",
            "   if(name == \"open\") return iOpen(_Symbol, _Period, shift);",
            "   if(name == \"high\") return iHigh(_Symbol, _Period, shift);",
            "   if(name == \"low\") return iLow(_Symbol, _Period, shift);",
            "   if(name == \"hl2\") return (iHigh(_Symbol, _Period, shift) + iLow(_Symbol, _Period, shift)) / 2.0;",
            "   if(name == \"hlc3\") return (iHigh(_Symbol, _Period, shift) + iLow(_Symbol, _Period, shift) + iClose(_Symbol, _Period, shift)) / 3.0;",
            "   return iClose(_Symbol, _Period, shift);",
            "}",
        ]
    )
    return "\n".join(lines).rstrip() + "\n", warnings


def _indicator_setup(indicator: Indicator) -> str | None:
    source = _applied_price(indicator.source)
    length = int(indicator.params.get("length", 14))
    if indicator.type == "sma":
        return f"iMA(_Symbol, _Period, {length}, 0, MODE_SMA, {source})"
    if indicator.type == "ema":
        return f"iMA(_Symbol, _Period, {length}, 0, MODE_EMA, {source})"
    if indicator.type == "rsi":
        return f"iRSI(_Symbol, _Period, {length}, {source})"
    if indicator.type == "macd":
        fast = int(indicator.params.get("fast", 12))
        slow = int(indicator.params.get("slow", 26))
        signal = int(indicator.params.get("signal", 9))
        return f"iMACD(_Symbol, _Period, {fast}, {slow}, {signal}, {source})"
    if indicator.type == "bbands":
        mult = float(indicator.params.get("mult", 2))
        return f"iBands(_Symbol, _Period, {length}, 0, {_num(mult)}, {source})"
    if indicator.type == "atr":
        return f"iATR(_Symbol, _Period, {length})"
    return None


def _channel_copy_lines(indicator: Indicator) -> list[str]:
    mode = "MODE_HIGH" if indicator.type == "highest" else "MODE_LOW"
    func = "iHighest" if indicator.type == "highest" else "iLowest"
    price = "iHigh" if indicator.type == "highest" else "iLow"
    length = int(indicator.params.get("length", 14))
    buf = _buf(indicator.id)
    return [
        f"   double {buf}[3]; ArraySetAsSeries({buf}, true);",
        f"   for(int shift = 0; shift < 3; shift++)",
        "   {",
        f"      int idx = {func}(_Symbol, _Period, {mode}, {length}, shift);",
        f"      if(idx < 0) return;",
        f"      {buf}[shift] = {price}(_Symbol, _Period, idx);",
        "   }",
    ]


def _buffer_index(indicator: Indicator) -> int:
    if indicator.type == "macd":
        return 1 if indicator.params.get("component") == "signal" else 0
    if indicator.type == "bbands":
        component = indicator.params.get("component")
        if component == "upper":
            return 1
        if component == "lower":
            return 2
    return 0


def _rules_expr(rules: list[Rule], rendered: set[str], unsupported: set[str], warnings: list[str]) -> str:
    parts: list[str] = []
    for rule in rules:
        refs = _rule_indicator_refs(rule)
        skipped = refs - rendered
        if skipped:
            if skipped & unsupported:
                warnings.append(f"Skipped rule referencing unsupported indicator(s): {', '.join(sorted(skipped))}")
            else:
                warnings.append(f"Skipped rule referencing unavailable indicator(s): {', '.join(sorted(skipped))}")
            continue
        parts.append(_rule_expr(rule))
    return " && ".join(f"({part})" for part in parts)


def _rule_expr(rule: Rule) -> str:
    left0 = _operand(rule.left, 0)
    left1 = _operand(rule.left, 1)
    if rule.op == "rising":
        return f"{left0} > {left1}"
    if rule.op == "falling":
        return f"{left0} < {left1}"
    right0 = _operand(rule.right, 0)
    right1 = _operand(rule.right, 1)
    if rule.op == "cross_above":
        return f"{left1} <= {right1} && {left0} > {right0}"
    if rule.op == "cross_below":
        return f"{left1} >= {right1} && {left0} < {right0}"
    return f"{left0} {rule.op} {right0}"


def _rule_indicator_refs(rule: Rule) -> set[str]:
    refs = set()
    for operand in (rule.left, rule.right):
        if operand and operand.kind == "indicator":
            refs.add(operand.ref)
    return refs


def _operand(operand: Operand | None, shift: int) -> str:
    if operand is None:
        return "0.0"
    if operand.kind == "indicator":
        return f"{_buf(operand.ref)}[{shift}]"
    if operand.kind == "price":
        return f'PriceValue("{operand.ref}", {shift})'
    return _num(operand.value or 0)


def _bool_expr(expr: str) -> str:
    return expr if expr else "false"


def _handle(value: str) -> str:
    return f"{_ident(value)}Handle"


def _buf(value: str) -> str:
    return f"{_ident(value)}Buf"


def _ident(value: str) -> str:
    ident = re.sub(r"\W+", "_", value.strip())
    if not ident or ident[0].isdigit():
        ident = f"i_{ident}"
    return ident


def _applied_price(source: str) -> str:
    return {
        "open": "PRICE_OPEN",
        "high": "PRICE_HIGH",
        "low": "PRICE_LOW",
        "close": "PRICE_CLOSE",
        "hl2": "PRICE_MEDIAN",
        "hlc3": "PRICE_TYPICAL",
    }.get(source, "PRICE_CLOSE")


def _quote(value: str) -> str:
    # Escape control chars too: a raw newline in the name would end the
    # `#property description "..."` line and break (or inject into) the EA source.
    return (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\r", "\\r")
        .replace("\n", "\\n")
        .replace("\t", "\\t")
    )


def _num(value: float | int) -> str:
    number = float(value)
    return str(int(number)) if number.is_integer() else str(number)
