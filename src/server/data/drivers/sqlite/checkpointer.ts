import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { checkpointsSqlitePath } from "../../../../utils/paths";

export function openSqliteCheckpointer(): SqliteSaver {
  return (SqliteSaver as unknown as { fromConnString: (s: string) => SqliteSaver }).fromConnString(
    checkpointsSqlitePath(),
  );
}
