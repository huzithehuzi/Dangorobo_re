// sql.js(1.14.1)는 타입 선언을 함께 배포하지 않는다. @types/sql.js를 의존성으로 들이는
// 대신, src/main/memory-sqlite.js가 **실제로 쓰는 API만** 여기 적는다.
//
// 쓰지 않는 것까지 옮겨 적지 않는 이유: 손으로 쓴 선언은 라이브러리와 어긋나도 아무도
// 모른다. 실제로 호출하는 것만 적어두면 어긋났을 때 그 자리에서 드러난다.
// 아래 시그니처는 sql.js 1.14.1을 직접 실행해 확인했다
// (run()은 자기 자신을 돌려주고, export()는 Uint8Array, close()는 undefined).

declare module "sql.js" {
  function initSqlJs(config?: Record<string, unknown>): Promise<initSqlJs.SqlJsStatic>;

  namespace initSqlJs {
    type SqlValue = number | string | Uint8Array | null;

    interface QueryExecResult {
      columns: string[];
      values: SqlValue[][];
    }

    interface Database {
      exec(sql: string, params?: SqlValue[]): QueryExecResult[];
      run(sql: string, params?: SqlValue[]): Database;
      export(): Uint8Array;
      close(): void;
    }

    interface DatabaseConstructor {
      new (data?: Uint8Array | null): Database;
    }

    interface SqlJsStatic {
      Database: DatabaseConstructor;
    }
  }

  export = initSqlJs;
}
