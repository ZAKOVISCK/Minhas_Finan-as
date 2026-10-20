declare module "*.html?raw" { const html: string; export default html; }

declare module "virtual:minhas-financas-release" {
  const release: {version:string;commit:string|null;repository:string};
  export default release;
}

declare module "virtual:minhas-financas-assets" {
 const files: Record<string,{base64:string;etag:string}>;
 export default files;
}
