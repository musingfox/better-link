export default {
  async fetch(): Promise<Response> {
    return new Response("not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
} satisfies ExportedHandler<Env>;
