import classNames from "classnames";
import { HTMLProps, forwardRef, useState } from "react";

type ButtonProps = Omit<HTMLProps<HTMLButtonElement>, "onClick"> & {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => Promise<void> | void;
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

  return (
    <button
      {...props}
      type="button"
      className={classNames(
        "p-2 rounded flex gap-1 items-center justify-center bg-slate-800 hover:bg-slate-600",
        props.className,
      )}
      ref={ref}
      onClick={clicking}
    >
      {spinning ? "Loading.." : props.children}
    </button>
  );
});
