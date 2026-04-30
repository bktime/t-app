export default {
  async fetch(request, env) {
    try {
      const result = await env.DB.prepare("SELECT 1 as test").all();
      return new Response(JSON.stringify(result), {
        headers: { "content-type": "application/json" }
      });
    } catch (err) {
      return new Response(err.toString());
    }
  }
};