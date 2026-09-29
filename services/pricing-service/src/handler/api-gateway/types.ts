export interface RequestContext {
  method: string;
  path: string;
  pathParams: Record<string, string>;
  query: Record<string, string>;
  body: any;
  user?: { id: string; role?: string };
}
