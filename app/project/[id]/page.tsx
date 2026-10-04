import { Studio } from "@/components/studio";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autostart?: string }>;
}) {
  const { id } = await params;
  const { autostart } = await searchParams;
  return <Studio projectId={id} autostart={autostart === "1"} />;
}
