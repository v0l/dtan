import classNames from "classnames";
import { HTMLProps, forwardRef, useState } from "react";

type ButtonProps = Omit<HTMLProps<HTMLButtonElement>, "onClick"> & {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => Promise<void> | void;
  type: "primary" | "secondary" | "danger";
  small?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => {
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

  const colorScheme =
    props.disabled ? "bg-neutral-900 text-neutral-600 border border-solid border-neutral-700" :
    props.type == "danger"
      ? "bg-red-900 hover:bg-red-600"
      : props.type == "primary"
        ? "bg-indigo-800 hover:bg-indigo-700"
        : "bg-neutral-800 hover:bg-neutral-700";

  return (
    <button
      {...props}
      type="button"
      className={classNames(
        props.small ? "px-3 py-1 rounded-2xl" : "px-4 py-3 rounded-full ",
        "flex gap-1 items-center justify-center  whitespace-nowrap",
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
