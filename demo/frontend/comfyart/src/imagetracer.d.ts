declare module 'imagetracerjs' {
  const tracer: { imagedataToSVG(data: ImageData, options?: string | Record<string, unknown>): string }
  export default tracer
}
