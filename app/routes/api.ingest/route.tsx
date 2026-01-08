import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { action as ingestAction, loader as ingestLoader } from "../ingest";

export const action = async (args: ActionFunctionArgs) => {
  return ingestAction(args);
};

export const loader = async (args: LoaderFunctionArgs) => {
  return ingestLoader(args);
};
