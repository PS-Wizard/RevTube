// ── shadcn-generated components + MUI compat shims ───────────────────────────
// Each compat wrapper is re-exported under the plain MUI name so existing pages
// keep working without any changes to their import sites.

// ── button ───────────────────────────────────────────────────────────────────
export { buttonVariants } from './button';
// ButtonCompat is the MUI-surface wrapper; exported as "Button" so all callers work
export { ButtonCompat as Button } from './button';
export type { ButtonProps } from './button';
// low-level shadcn button for internal use
export { Button as ShadcnButton } from './button';

// ── card ─────────────────────────────────────────────────────────────────────
export {
  Card, CardHeader, CardFooter, CardTitle, CardAction,
  CardDescription, CardContent, CardActions,
} from './card';

// ── accordion ────────────────────────────────────────────────────────────────
export {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
  AccordionCompat, AccordionSummary, AccordionDetails,
} from './accordion';
export type { AccordionProps, AccordionCompatProps, AccordionSummaryProps, AccordionDetailsProps } from './accordion';

// ── alert ────────────────────────────────────────────────────────────────────
export {
  AlertCompat as Alert,
  Alert as ShadcnAlert,
  AlertTitle,
  AlertDescription,
  AlertAction,
  AlertCompat,
} from './alert';
export type { AlertSeverity, AlertCompatProps } from './alert';

// ── avatar ───────────────────────────────────────────────────────────────────
export {
  AvatarImage, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarBadge,
  AvatarCompat as Avatar,
} from './avatar';
export type { AvatarCompatProps, AvatarSize } from './avatar';

// ── badge ────────────────────────────────────────────────────────────────────
export { badgeVariants, BadgeCompat as Badge } from './badge';
export type { BadgeCompatProps, BadgeColor, BadgeProps } from './badge';

// ── checkbox ─────────────────────────────────────────────────────────────────
export { Checkbox as ShadcnCheckbox, CheckboxCompat as Checkbox } from './checkbox';
export type { CheckboxProps } from './checkbox';

// ── dialog ───────────────────────────────────────────────────────────────────
// `Dialog` is the single, self-contained shell (Root + Portal + Overlay +
// Content). Content sub-parts compose *inside* it — they render no portal or
// overlay of their own.
export {
  Dialog,
  DialogTitle, DialogBody, DialogActions,
  DialogHeader, DialogFooter, DialogDescription,
  DialogClose, DialogTrigger,
} from './dialog';
export type { DialogProps, DialogTitleProps, DialogBodyProps, DialogActionsProps } from './dialog';

export { DialogTitleBlock } from './DialogTitleBlock';
export type { DialogTitleBlockProps } from './DialogTitleBlock';

// ── popover ──────────────────────────────────────────────────────────────────
export {
  PopoverCompat as Popover,
  Popover as ShadcnPopover,
  PopoverAnchor, PopoverContent, PopoverDescription,
  PopoverHeader, PopoverTitle, PopoverTrigger,
  PopoverCompat,
} from './popover';
export type { PopoverProps, PopoverCompatProps } from './popover';

// ── progress ─────────────────────────────────────────────────────────────────
export { Progress as ShadcnProgress, ProgressCompat as Progress } from './progress';
export type { ProgressProps, ProgressSize } from './progress';

// ── select ───────────────────────────────────────────────────────────────────
export {
  Select as ShadcnSelect,
  SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectScrollDownButton, SelectScrollUpButton, SelectSeparator,
  SelectTrigger, SelectValue,
  SelectCompat as Select,
  MenuItem,
} from './select';
export type { SelectChangeEvent, SelectCompatProps, SelectProps } from './select';

// ── switch ───────────────────────────────────────────────────────────────────
export { Switch as ShadcnSwitch, SwitchCompat as Switch } from './switch';
export type { SwitchProps } from './switch';

// ── table ────────────────────────────────────────────────────────────────────
export {
  Table as ShadcnTable,
  TableHeader, TableBody, TableFooter, TableHead,
  TableRow, TableCaption,
  TableCell as ShadcnTableCell,
  TableCompat as Table,
  TableContainer,
  TableCellCompat as TableCell,
} from './table';
export type { TableProps, TableContainerProps, TableCellProps } from './table';
// aliases for MUI sub-exports
export type { TableProps as TableBodyProps, TableProps as TableHeadProps, TableProps as TableRowProps } from './table';

// ── tabs ─────────────────────────────────────────────────────────────────────
export {
  Tabs as ShadcnTabs, TabsList, TabsTrigger, TabsContent, tabsListVariants,
  TabsCompat as Tabs,
  Tab,
} from './tabs';
export type { TabsProps, TabProps } from './tabs';

// ── tooltip ──────────────────────────────────────────────────────────────────
export { Tooltip as ShadcnTooltip, TooltipContent, TooltipProvider, TooltipTrigger, TooltipCompat as Tooltip } from './tooltip';
export type { TooltipProps } from './tooltip';

// ── pagination ───────────────────────────────────────────────────────────────
export {
  Pagination as ShadcnPagination,
  PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
  PaginationCompat as Pagination,
} from './pagination';
export type { PaginationProps, PaginationCompatProps } from './pagination';

// ── Kept custom (no shadcn equivalent) ───────────────────────────────────────

export { Box } from './Box';
export type { BoxProps } from './Box';

export { Stack, Flex } from './Stack';
export type { StackProps, FlexProps } from './Stack';

export { Grid } from './Grid';
export type { GridProps } from './Grid';

export { Container } from './Container';
export type { ContainerProps } from './Container';

export { Paper } from './Paper';
export type { PaperProps } from './Paper';

export { Typography } from './Typography';
export type { TypographyProps } from './Typography';

export { IconButton } from './IconButton';
export type { IconButtonProps, IconButtonVariant, IconButtonSize } from './IconButton';

export { Divider } from './Divider';
export type { DividerProps } from './Divider';

export { Link } from './Link';
export type { LinkProps } from './Link';

export { Chip } from './Chip';
export type { ChipProps, ChipVariant } from './Chip';

export {
  List, ListItem, ListItemButton, ListItemIcon, ListItemAvatar, ListItemText,
} from './List';
export type {
  ListProps, ListItemProps, ListItemButtonProps,
  ListItemIconProps, ListItemAvatarProps, ListItemTextProps,
} from './List';

export { Menu, MenuItem as MenuItemBase } from './Menu';
export type { MenuProps, MenuItemProps } from './Menu';

export { FormControl, FormControlLabel, InputAdornment, InputLabel } from './FormControl';
export type {
  FormControlProps, FormControlLabelProps,
  InputAdornmentProps, InputLabelProps,
} from './FormControl';

export { TextField } from './TextField';
export type { TextFieldProps } from './TextField';

export { Spinner } from './Spinner';
export type { SpinnerProps, SpinnerPresetSize } from './Spinner';

export {
  Modal, ModalHeader, ModalBody, ModalFooter,
  // Canonical `Dialog` lives in './dialog' (Radix). These are the legacy
  // Modal sub-components, renamed so the barrel exports a single Dialog API.
  DialogHeader as DialogHeaderModal, DialogBody as DialogBodyModal, DialogFooter as DialogFooterModal,
} from './Modal';
export type { ModalProps, ModalAction } from './Modal';


export { Input } from './Input';
export type { InputProps } from './Input';

export { NativeSelect } from './NativeSelect';

export { Toggle } from './Toggle';
export type { ToggleProps } from './Toggle';

export { ToggleChip } from './ToggleChip';
export type { ToggleChipProps, ToggleChipSize, ToggleChipTone } from './ToggleChip';

export { VisuallyHidden } from './VisuallyHidden';

export { SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps, SegmentedControlOption } from './SegmentedControl';

export { IconMedallion } from './IconMedallion';
export type { IconMedallionProps, IconMedallionTone } from './IconMedallion';

export * from './chat';

export { StatCard } from './StatCard';
export type { StatCardProps, StatCardTone } from './StatCard';

export { Form, FormField, FormActions, FormHint, FormError } from './Form';
export type { FormProps, FormFieldProps } from './Form';

export {
  DropdownTrigger, DropdownPanel, DropdownItem,
  DropdownHeader, DropdownTitle, DropdownList, DropdownFooter,
} from './Dropdown';
