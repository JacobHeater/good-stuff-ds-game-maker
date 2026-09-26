/** Images imported by the editor are bundled by Vite and come back as a URL. */
declare module "*.png" {
  const url: string;
  export default url;
}
