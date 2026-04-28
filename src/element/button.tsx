import classNames from "classnames";
import { HTMLProps, forwardRef, useState } from "react";

type ButtonProps = Omit<HTMLProps<HTMLButtonElement>, "onClick" | "small"> & {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => Promise<void> | void;
  type: "primary" | "secondary" | "danger" | "zap";
  small?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ small, ...props }, ref) => {
  const [spinning, setSpinning] = useState(false);

  async function clicking(e: React.MouseEvent<HTMLButtonElement>) {
    if (!props.onClick) return;
    e.preventDefault();
    try {
      setSpinning(true);
      await props?.onClick?.(e);
    } finally {
      setSpinning(false);
    }
  }

  function matchType(type: ButtonProps["type"]) {
    switch (type) {
      case "danger": {
        return "bg-red-900 hover:bg-red-600";
      }
      case "primary": {
        return "bg-indigo-800 hover:bg-indigo-700";
      }
      case "zap": {
        return "bg-orange-500 hover:bg-orange-400";
      }
      default: {
        return "bg-neutral-800 hover:bg-neutral-700";
      }
    }
  }

  const colorScheme = props.disabled
    ? "bg-neutral-900 text-neutral-600 border border-solid border-neutral-700"
    : matchType(props.type);

  return (
    <button
      {...props}
      type="button"
      className={classNames(
        small ? "px-3 py-1 rounded-2xl" : "px-4 py-3 rounded-xl ",
        "flex gap-1 items-center justify-center  whitespace-nowrap cursor-pointer",
        colorScheme,
        props.className,
      )}
      ref={ref}
      onClick={clicking}
    >
      {spinning ? "Loading..." : props.children}
    </button>
  );
});
