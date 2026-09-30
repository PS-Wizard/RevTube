import * as React from "react";
import { cn } from "@/lib/utils";

// Centralized chat primitives — Tailwind lives ONLY here (allowed: src/components/ui/**).
// Pages (ChatPage, AdminPage) compose these and pass props/sx, never raw className utilities.

export function ChatRoot({ mode = "user", className, ...props }: React.HTMLAttributes<HTMLDivElement> & { mode?: "user" | "admin" }) {
  return (
    <div
      className={cn(
        "flex w-full overflow-hidden bg-background font-sans border-border",
        mode === "admin"
          ? "rounded-lg border shadow-xs min-h-[calc(100dvh-var(--sticky-top-height,58px)-96px)] max-h-[calc(100dvh-var(--sticky-top-height,58px)-96px)] max-md:min-h-[calc(100dvh-var(--sticky-top-height,58px)-72px)] max-md:max-h-[calc(100dvh-var(--sticky-top-height,58px)-72px)]"
          : "min-h-[calc(100dvh-var(--sticky-top-height,58px))] max-h-[calc(100dvh-var(--sticky-top-height,58px))]",
        className,
      )}
      {...props}
    />
  );
}

export function ChatOverlay({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <div
      className={cn("fixed inset-0 z-30 hidden bg-black/40 backdrop-blur-[2px]", open && "max-md:block")}
      onClick={onClick}
    />
  );
}

export function ChatSidebar({
  collapsed,
  drawerOpen,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { collapsed?: boolean; drawerOpen?: boolean }) {
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col overflow-hidden border-r bg-card transition-all duration-300 z-10",
        collapsed ? "w-14" : "w-[280px]",
        "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-md max-md:w-[280px]",
        drawerOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        className,
      )}
      {...props}
    />
  );
}

export function ChatSidebarHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex h-12 shrink-0 items-center justify-between border-b px-3", className)} {...props} />;
}

export function ChatSidebarList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto py-2", className)} {...props} />;
}

export function ChatSidebarItem({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 border-l-[3px] px-4 py-3 text-left transition-colors hover:bg-muted",
        active ? "bg-muted border-primary" : "border-transparent",
        className,
      )}
      {...props}
    />
  );
}

export function ChatMain({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-w-0 flex-1 flex-col bg-background relative min-h-0 max-h-full", className)} {...props} />;
}

export function ChatMobileTopbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("hidden h-12 shrink-0 items-center gap-2 border-b bg-card px-3 max-md:flex", className)} {...props} />;
}

export const ChatMessages = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function ChatMessages(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn("flex flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-6 max-md:p-4 max-sm:p-3 min-h-0", className)} {...props} />;
});

export function ChatEmptyState({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto flex flex-1 max-w-[600px] flex-col items-center justify-center gap-4 p-8 text-center max-md:p-4", className)} {...props} />;
}

export function MessageRow({
  isUser,
  isStreaming,
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { isUser?: boolean; isStreaming?: boolean }) {
  return (
    <div
      className={cn(
        "flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300",
        isUser ? "justify-end" : "justify-start",
        isStreaming && "animate-none",
        className,
      )}
      style={style}
      {...props}
    />
  );
}

export function MessageWrapper({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex max-w-[80%] flex-col max-md:max-w-[90%]", className)} {...props} />;
}

export function MessageMeta({ isUser, className, ...props }: React.HTMLAttributes<HTMLDivElement> & { isUser?: boolean }) {
  return <div className={cn("mb-1 flex items-center gap-2 px-1 text-xs text-muted-foreground", isUser && "flex-row-reverse", className)} {...props} />;
}

export function MessageBubble({
  isUser,
  isStreaming,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { isUser?: boolean; isStreaming?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl p-4 text-sm leading-relaxed break-words shadow-xs transition-colors min-w-0 max-md:p-3",
        // table borders inside bubbles — centralized (was in deleted ChatPage.css)
        "[&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_table]:text-sm [&_table]:overflow-hidden [&_table]:rounded-md [&_table]:border [&_table]:border-border",
        "[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground",
        "[&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_td]:text-left [&_td]:align-middle",
        "[&_tr:last-child_td]:border-b-0",
        isUser
          ? "bg-primary text-primary-foreground rounded-br-sm [&_table]:border-white/20 [&_th]:!bg-white/10 [&_th]:!border-white/20 [&_th]:!text-primary-foreground [&_td]:!border-white/20 [&_a]:!text-primary-foreground [&_a]:underline"
          : "bg-card text-card-foreground border rounded-bl-sm",
        isStreaming && "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]",
        className,
      )}
      {...props}
    />
  );
}

export function ChatThinkingCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex max-w-[80%] animate-in fade-in max-md:max-w-[90%]", className)} {...props} />;
}

export function ChatThinkingInner({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("overflow-hidden rounded-lg border border-border bg-card shadow-xs border-l-[3px] border-l-primary", className)}
      {...props}
    />
  );
}

export function ChatToolChip({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("inline-flex items-center gap-2 rounded-full border bg-card px-3 py-2 text-sm shadow-xs animate-in fade-in", className)}
      {...props}
    />
  );
}

export function ChatSkeletonGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex max-w-[80%] flex-col gap-2 animate-in fade-in max-md:max-w-[90%]", className)} {...props} />;
}

export function ChatErrorBanner({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="alert" className={cn("mx-6 mb-2 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive max-md:mx-4", className)} {...props} />;
}

export function ChatInputPanel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shrink-0 border-t bg-card p-4 max-md:p-3", className)} {...props} />;
}

export function ChatInputWrapper({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3 pl-4 shadow-xs focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10",
        className,
      )}
      {...props}
    />
  );
}

export function ChannelPill({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary", className)} {...props} />;
}

export function ChatChannelSearchWrap({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("relative mb-2 flex items-center", className)} {...props} />;
}

export function ChatScrollBottomWrap({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("absolute bottom-24 right-6 z-10", className)} {...props} />;
}
