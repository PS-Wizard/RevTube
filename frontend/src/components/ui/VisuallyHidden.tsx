import * as React from "react";
import { VisuallyHidden as VisuallyHiddenPrimitive } from "radix-ui";

/**
 * VisuallyHidden — screen-reader-only content.
 *
 * The single sanctioned replacement for the `sr-only` utility outside
 * shared primitives. Pages must use this, never `className="sr-only"`.
 */
function VisuallyHidden({
  children,
  ...props
}: React.ComponentProps<typeof VisuallyHiddenPrimitive.Root>) {
  return <VisuallyHiddenPrimitive.Root {...props}>{children}</VisuallyHiddenPrimitive.Root>;
}

export { VisuallyHidden };
export default VisuallyHidden;
