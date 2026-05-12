"use client";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return <SonnerToaster theme="dark" toastOptions={{ classNames: { toast: "rounded-md border" } }} {...props} />;
}
