import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { DialogClose } from "@/components/ui/dialog"
import { DialogDescription } from "@/components/ui/dialog"
import { DialogHeader } from "@/components/ui/dialog"
import { DialogTitle } from "@/components/ui/dialog"
import { IconButton } from "@/components/ui/IconButton"
import { IconMedallion, type IconMedallionTone } from "@/components/ui/IconMedallion"

export interface DialogTitleBlockProps {
  /** Icon rendered inside the medallion (e.g. `<Film size={18} />`). */
  icon: React.ReactNode;
  /** Main title (truncated with full text on hover). */
  title: string;
  /** One-line subtitle under the title. */
  subtitle?: string;
  /** Medallion tone. Default `primary`. */
  tone?: IconMedallionTone;
  /** Accessible label for the close button. */
  closeLabel?: string;
  className?: string;
}

/**
 * DialogTitleBlock — the single sanctioned dialog header.
 *
 * Every dialog renders: icon medallion + title + subtitle + close (X)
 * button, then its content, then (only for action dialogs) a footer with
 * close/submit buttons. Informational dialogs render NO footer — the X
 * plus backdrop/Escape is the way out.
 */
export function DialogTitleBlock({
  icon,
  title,
  subtitle,
  tone = "primary",
  closeLabel = "Close dialog",
  className,
}: DialogTitleBlockProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b border-border px-4 pt-4 pb-3 sm:px-6 sm:pt-5",
        className,
      )}
    >
      <IconMedallion tone={tone} size={36} className="shrink-0">
        {icon}
      </IconMedallion>
      <DialogHeader className="min-w-0 flex-1">
        <DialogTitle
          title={title}
          className="truncate text-base font-bold tracking-normal"
        >
          {title}
        </DialogTitle>
        {subtitle && (
          <DialogDescription title={subtitle} className="truncate text-xs">
            {subtitle}
          </DialogDescription>
        )}
      </DialogHeader>
      <DialogClose asChild>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={closeLabel}
          className="shrink-0"
        >
          <X size={16} />
        </IconButton>
      </DialogClose>
    </div>
  )
}

export default DialogTitleBlock
