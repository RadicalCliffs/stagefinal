import { type ReactNode } from 'react';

interface SkeletonProps {
  className?: string;
  animate?: boolean;
}

// Base skeleton component with shimmer animation
export function Skeleton({ className = '', animate = true }: SkeletonProps) {
  return (
    <div
      className={`bg-white/10 rounded ${animate ? 'animate-pulse' : ''} ${className}`}
      aria-hidden="true"
    />
  );
}

// Skeleton for avatar/profile images
export function SkeletonAvatar({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  };
  return <Skeleton className={`${sizes[size]} rounded-full`} />;
}

// Skeleton for text lines
export function SkeletonText({
  lines = 1,
  className = ''
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-4 ${i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

// Skeleton for entry/activity cards
export function SkeletonEntryCard() {
  return (
    <div className="bg-[#262626] border border-white/10 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-3">
        <SkeletonAvatar />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-6 w-16 rounded-md" />
      </div>
      <div className="flex justify-between items-center pt-2 border-t border-white/10">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

// Skeleton for competition cards
export function SkeletonCompetitionCard() {
  return (
    <div className="bg-[#262626] border border-white/10 rounded-xl overflow-hidden">
      <Skeleton className="h-48 w-full rounded-none" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <div className="flex justify-between items-center pt-3">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>
    </div>
  );
}

// Skeleton for table rows
export function SkeletonTableRow({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex items-center gap-4 p-4 border-b border-white/10">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} className={`h-4 flex-1 ${i === 0 ? 'max-w-[100px]' : ''}`} />
      ))}
    </div>
  );
}

// Skeleton list wrapper
export function SkeletonList({
  count = 5,
  children
}: {
  count?: number;
  children: (index: number) => ReactNode;
}) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading content">
      {Array.from({ length: count }).map((_, i) => children(i))}
      <span className="sr-only">Loading...</span>
    </div>
  );
}

// Skeleton for recent activity table
export function SkeletonActivityRow() {
  return (
    <div className="flex items-center gap-4 p-3 bg-[#1A1A1A] rounded-lg">
      <SkeletonAvatar size="sm" />
      <div className="flex-1 min-w-0">
        <Skeleton className="h-4 w-24 mb-1" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-5 w-12 rounded" />
      <Skeleton className="h-4 w-16 hidden sm:block" />
      <Skeleton className="h-4 w-12" />
    </div>
  );
}

// Skeleton for user dashboard entries
export function SkeletonDashboardEntry() {
  return (
    <div className="bg-[#1E1E1E] border border-white/20 rounded-xl p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row gap-4">
        <Skeleton className="w-full sm:w-24 h-24 rounded-lg" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="flex gap-2 flex-wrap">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </div>
        <div className="flex sm:flex-col justify-between sm:justify-start items-end gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
    </div>
  );
}

// Loading state wrapper with skeleton
export function LoadingState({
  isLoading,
  skeleton,
  children
}: {
  isLoading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
}) {
  return isLoading ? <>{skeleton}</> : <>{children}</>;
}
