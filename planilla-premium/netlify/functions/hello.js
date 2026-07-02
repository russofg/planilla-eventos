export default async () => {
  return new Response(JSON.stringify({ message: "hello from V2 function!" }), {
    headers: { "Content-Type": "application/json" }
  });
};

export const config = {
  path: "/.netlify/functions/hello"
};
