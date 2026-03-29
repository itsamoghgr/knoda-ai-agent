import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_STYLES } from "@/lib/theme";
import type { JobStatus } from "@/types/api";

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const { label, className } = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", className)}>
      {label}
    </Badge>
  );
}
