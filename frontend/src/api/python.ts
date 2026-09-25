import { api } from "./base";
import type {
  PythonExecuteResponse,
} from "../types";

export async function executePython(payload: { code: string; timeout_seconds?: number }): Promise<PythonExecuteResponse> {
  const { data } = await api.post<PythonExecuteResponse>("/v1/scripting/python/execute", payload);
  return data;
}
