export async function onRequest({ env }) {
  try {
    const test = await env.DB.prepare("SELECT 1 as ok").all();

    return Response.json({
      db: "connected",
      test
    });

  } catch (e) {
    return Response.json({
      db: "failed",
      error: e.message
    }, { status: 500 });
  }
}
