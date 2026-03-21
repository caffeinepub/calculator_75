import { useCallback, useEffect, useRef, useState } from "react";

type BtnVariant = "digit" | "op" | "fn" | "eq";

interface CalcButton {
  label: string;
  ocid: string;
  variant: BtnVariant;
  action: () => void;
  wide?: boolean;
}

function formatDisplay(value: string): string {
  if (value === "Error" || value === "Infinity" || value === "-Infinity")
    return value;
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return value;
  // Format large/small numbers with exponential
  if (Math.abs(num) >= 1e10 || (Math.abs(num) < 1e-6 && Math.abs(num) > 0)) {
    return num.toPrecision(8).replace(/\.?0+e/, "e");
  }
  // Trim unnecessary trailing zeros for floats
  const parts = value.split(".");
  if (parts.length === 2) {
    return value; // keep as-is while typing
  }
  return value;
}

export default function App() {
  const [display, setDisplay] = useState("0");
  const [expression, setExpression] = useState("");
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [operator, setOperator] = useState<string | null>(null);
  const [prevValue, setPrevValue] = useState<number | null>(null);
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const flashButton = useCallback((ocid: string) => {
    setPressedKey(ocid);
    setTimeout(() => setPressedKey(null), 120);
  }, []);

  const inputDigit = useCallback(
    (digit: string) => {
      setDisplay((prev) => {
        if (waitingForOperand || justEvaluated) {
          setWaitingForOperand(false);
          setJustEvaluated(false);
          return digit;
        }
        if (prev === "0" && digit !== ".") return digit;
        if (digit === "." && prev.includes(".")) return prev;
        return prev + digit;
      });
      if (waitingForOperand || justEvaluated) {
        setWaitingForOperand(false);
        setJustEvaluated(false);
      }
    },
    [waitingForOperand, justEvaluated],
  );

  const inputDecimal = useCallback(() => {
    setDisplay((prev) => {
      if (waitingForOperand || justEvaluated) {
        setWaitingForOperand(false);
        setJustEvaluated(false);
        return "0.";
      }
      if (prev.includes(".")) return prev;
      return `${prev}.`;
    });
  }, [waitingForOperand, justEvaluated]);

  const clear = useCallback(() => {
    setDisplay("0");
    setExpression("");
    setWaitingForOperand(false);
    setOperator(null);
    setPrevValue(null);
    setJustEvaluated(false);
  }, []);

  const toggleSign = useCallback(() => {
    setDisplay((prev) => {
      if (prev === "0" || prev === "Error") return prev;
      return prev.startsWith("-") ? prev.slice(1) : `-${prev}`;
    });
  }, []);

  const percentage = useCallback(() => {
    setDisplay((prev) => {
      const num = Number.parseFloat(prev);
      if (Number.isNaN(num)) return prev;
      if (prevValue !== null && operator) {
        // % relative to prevValue for +/-
        if (operator === "+" || operator === "-") {
          return String((prevValue * num) / 100);
        }
      }
      return String(num / 100);
    });
  }, [prevValue, operator]);

  const handleOperator = useCallback(
    (nextOp: string) => {
      const current = Number.parseFloat(display);
      if (prevValue !== null && !waitingForOperand && !justEvaluated) {
        // Chain calculation
        let result = prevValue;
        switch (operator) {
          case "+":
            result = prevValue + current;
            break;
          case "-":
            result = prevValue - current;
            break;
          case "×":
            result = prevValue * current;
            break;
          case "÷":
            result = current === 0 ? Number.NaN : prevValue / current;
            break;
        }
        if (Number.isNaN(result)) {
          setDisplay("Error");
          setExpression("");
          setOperator(null);
          setPrevValue(null);
          setWaitingForOperand(true);
          return;
        }
        const resultStr = Number.isInteger(result)
          ? String(result)
          : String(Number.parseFloat(result.toPrecision(12)));
        setDisplay(resultStr);
        setExpression(`${resultStr} ${nextOp}`);
        setPrevValue(result);
      } else {
        setExpression(`${display} ${nextOp}`);
        setPrevValue(current);
      }
      setOperator(nextOp);
      setWaitingForOperand(true);
      setJustEvaluated(false);
    },
    [display, prevValue, operator, waitingForOperand, justEvaluated],
  );

  const evaluate = useCallback(() => {
    const current = Number.parseFloat(display);
    if (prevValue === null || operator === null) return;
    let result: number;
    switch (operator) {
      case "+":
        result = prevValue + current;
        break;
      case "-":
        result = prevValue - current;
        break;
      case "×":
        result = prevValue * current;
        break;
      case "÷":
        if (current === 0) {
          setDisplay("Error");
          setExpression("");
          setOperator(null);
          setPrevValue(null);
          setWaitingForOperand(true);
          setJustEvaluated(true);
          return;
        }
        result = prevValue / current;
        break;
      default:
        return;
    }
    const expr = expression.trimEnd().endsWith(operator)
      ? `${expression} ${display} =`
      : `${expression} =`;
    setExpression(expr);
    const resultStr = Number.isInteger(result)
      ? String(result)
      : String(Number.parseFloat(result.toPrecision(12)));
    setDisplay(resultStr);
    setPrevValue(null);
    setOperator(null);
    setWaitingForOperand(false);
    setJustEvaluated(true);
  }, [display, prevValue, operator, expression]);

  const backspace = useCallback(() => {
    setDisplay((prev) => {
      if (prev === "Error" || prev.length <= 1) return "0";
      const next = prev.slice(0, -1);
      return next === "-" ? "0" : next;
    });
  }, []);

  // Keyboard support
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        inputDigit(e.key);
        flashButton(`calc.digit_${e.key}`);
      } else if (e.key === ".") {
        inputDecimal();
        flashButton("calc.decimal_button");
      } else if (e.key === "+") {
        handleOperator("+");
        flashButton("calc.add_button");
      } else if (e.key === "-") {
        handleOperator("-");
        flashButton("calc.subtract_button");
      } else if (e.key === "*") {
        handleOperator("×");
        flashButton("calc.multiply_button");
      } else if (e.key === "/") {
        e.preventDefault();
        handleOperator("÷");
        flashButton("calc.divide_button");
      } else if (e.key === "Enter" || e.key === "=") {
        evaluate();
        flashButton("calc.equals_button");
      } else if (e.key === "Escape") {
        clear();
        flashButton("calc.clear_button");
      } else if (e.key === "Backspace") {
        backspace();
      } else if (e.key === "%") {
        percentage();
        flashButton("calc.percent_button");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    inputDigit,
    inputDecimal,
    handleOperator,
    evaluate,
    clear,
    backspace,
    percentage,
    flashButton,
  ]);

  const displayFontSize =
    display.length > 10
      ? "text-3xl"
      : display.length > 7
        ? "text-4xl"
        : "text-5xl";

  const buttons: CalcButton[] = [
    { label: "C", ocid: "calc.clear_button", variant: "fn", action: clear },
    {
      label: "+/−",
      ocid: "calc.sign_button",
      variant: "fn",
      action: toggleSign,
    },
    {
      label: "%",
      ocid: "calc.percent_button",
      variant: "fn",
      action: percentage,
    },
    {
      label: "÷",
      ocid: "calc.divide_button",
      variant: "op",
      action: () => handleOperator("÷"),
    },

    {
      label: "7",
      ocid: "calc.digit_7",
      variant: "digit",
      action: () => inputDigit("7"),
    },
    {
      label: "8",
      ocid: "calc.digit_8",
      variant: "digit",
      action: () => inputDigit("8"),
    },
    {
      label: "9",
      ocid: "calc.digit_9",
      variant: "digit",
      action: () => inputDigit("9"),
    },
    {
      label: "×",
      ocid: "calc.multiply_button",
      variant: "op",
      action: () => handleOperator("×"),
    },

    {
      label: "4",
      ocid: "calc.digit_4",
      variant: "digit",
      action: () => inputDigit("4"),
    },
    {
      label: "5",
      ocid: "calc.digit_5",
      variant: "digit",
      action: () => inputDigit("5"),
    },
    {
      label: "6",
      ocid: "calc.digit_6",
      variant: "digit",
      action: () => inputDigit("6"),
    },
    {
      label: "−",
      ocid: "calc.subtract_button",
      variant: "op",
      action: () => handleOperator("-"),
    },

    {
      label: "1",
      ocid: "calc.digit_1",
      variant: "digit",
      action: () => inputDigit("1"),
    },
    {
      label: "2",
      ocid: "calc.digit_2",
      variant: "digit",
      action: () => inputDigit("2"),
    },
    {
      label: "3",
      ocid: "calc.digit_3",
      variant: "digit",
      action: () => inputDigit("3"),
    },
    {
      label: "+",
      ocid: "calc.add_button",
      variant: "op",
      action: () => handleOperator("+"),
    },

    {
      label: "0",
      ocid: "calc.digit_0",
      variant: "digit",
      action: () => inputDigit("0"),
      wide: true,
    },
    {
      label: ".",
      ocid: "calc.decimal_button",
      variant: "digit",
      action: inputDecimal,
    },
    { label: "=", ocid: "calc.equals_button", variant: "eq", action: evaluate },
  ];

  const variantStyles: Record<BtnVariant, string> = {
    digit:
      "bg-calc-digit hover:bg-calc-digit-hover text-foreground shadow-btn-digit",
    op: "bg-calc-op hover:bg-calc-op-hover text-foreground shadow-btn-op",
    fn: "bg-calc-fn hover:bg-calc-fn-hover text-foreground shadow-btn-fn",
    eq: "bg-calc-eq hover:bg-calc-eq-hover text-primary-foreground shadow-btn-eq",
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-8">
      {/* Calculator body */}
      <div
        className="w-full max-w-xs rounded-3xl overflow-hidden shadow-calc animate-slide-up"
        style={{ background: "oklch(var(--calc-bg))" }}
      >
        {/* Display */}
        <div
          data-ocid="calc.display"
          className="px-6 pt-8 pb-5 flex flex-col items-end gap-1 select-none"
          style={{ background: "oklch(var(--calc-display-bg))" }}
        >
          {/* Expression row */}
          <div
            className="h-5 text-sm font-sans text-right truncate w-full"
            style={{ color: "oklch(0.65 0.01 60)" }}
          >
            {expression || "\u00A0"}
          </div>
          {/* Main number */}
          <div
            className={`font-display ${displayFontSize} leading-none tracking-tight text-right w-full truncate`}
            style={{
              color:
                display === "Error"
                  ? "oklch(0.62 0.17 22)"
                  : "oklch(0.97 0.005 80)",
            }}
          >
            {formatDisplay(display)}
          </div>
        </div>

        {/* Button grid */}
        <div className="p-4 grid grid-cols-4 gap-3">
          {buttons.map((btn) => (
            <button
              type="button"
              key={btn.ocid}
              data-ocid={btn.ocid}
              ref={(el) => {
                btnRefs.current[btn.ocid] = el;
              }}
              onClick={() => {
                btn.action();
                flashButton(btn.ocid);
              }}
              className={[
                "rounded-2xl h-16 flex items-center justify-center",
                "font-sans font-medium text-xl",
                "transition-all duration-75 cursor-pointer select-none",
                "active:translate-y-px active:shadow-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                variantStyles[btn.variant],
                btn.wide ? "col-span-2" : "",
                pressedKey === btn.ocid
                  ? "translate-y-px shadow-none brightness-90"
                  : "",
              ].join(" ")}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-4 pb-4 text-center">
          <p className="text-xs" style={{ color: "oklch(0.60 0.02 70)" }}>
            Keyboard supported · Esc to clear · Enter to evaluate
          </p>
        </div>
      </div>

      {/* Branding */}
      <footer className="mt-8 text-center">
        <p className="text-xs" style={{ color: "oklch(0.60 0.015 70)" }}>
          © {new Date().getFullYear()}. Built with ♥ using{" "}
          <a
            href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            caffeine.ai
          </a>
        </p>
      </footer>
    </div>
  );
}
