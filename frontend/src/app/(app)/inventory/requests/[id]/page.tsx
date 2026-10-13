"use client";
import { useParams } from "next/navigation";
import BranchRequestForm from "@/components/BranchRequestForm";

export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  return <BranchRequestForm id={id} />;
}
