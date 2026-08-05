import agentScript from "../../public/iris-agent-macos.sh?raw";

export async function GET() {
  return new Response(agentScript, {
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Content-Disposition": 'attachment; filename="iris-agent-macos.sh"',
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
