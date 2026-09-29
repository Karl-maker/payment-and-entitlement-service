export interface RequestContext {
  method: string;
  path: string;
  pathParams: Record<string, string>;
  query: Record<string, string>;
  body: any;
  headers?: Record<string, string>;
  user?: {
    id: string;
    role?: string;
  };
}
