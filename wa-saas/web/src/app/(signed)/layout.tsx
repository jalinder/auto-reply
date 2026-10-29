'use client';
import { WorkspaceProvider } from '@/components/providers';
export default function SignedLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
