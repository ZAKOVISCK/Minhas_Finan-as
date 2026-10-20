declare module "*.html?raw" { const html: string; export default html; }

declare module "virtual:minhas-financas-release" {
  const release: {version:string;commit:string|null;repository:string};
  export default release;
}
