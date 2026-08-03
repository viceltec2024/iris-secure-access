export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      url: "data:text/javascript,export const env = Object.create(null);",
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}
