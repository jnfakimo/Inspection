"""Create the LibreOffice Base front end for the Supabase read-only views.

Run with LibreOffice's bundled Python while a UNO listener is available.
The generated ODB stores the host and user name, but never a password.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import uno


POOLER_HOST = "aws-1-ap-northeast-2.pooler.supabase.com"
POOLER_PORT = 5432
DATABASE = "postgres"
PROJECT_REF = "qztffronusdhgxhjjubt"
DATABASE_USER = f"office_manager.{PROJECT_REF}"

QUERIES = {
    "Q01_設備清冊": (
        "SELECT * FROM public.vw_manager_equipment "
        "ORDER BY equipment_code"
    ),
    "Q02_今日巡檢": (
        "SELECT * FROM public.vw_manager_today_inspections "
        "ORDER BY inspect_time DESC"
    ),
    "Q03_異常巡檢": (
        "SELECT * FROM public.vw_manager_abnormal_inspections "
        "ORDER BY inspect_time DESC"
    ),
    "Q04_全部巡檢紀錄": (
        "SELECT * FROM public.vw_manager_inspections "
        "ORDER BY inspect_time DESC"
    ),
    "Q05_未結案報修": (
        "SELECT * FROM public.vw_manager_open_repairs "
        "ORDER BY created_at DESC"
    ),
    "Q06_全部報修": (
        "SELECT * FROM public.vw_manager_repairs "
        "ORDER BY created_at DESC"
    ),
    "Q07_每月KPI": (
        "SELECT * FROM public.vw_manager_monthly_kpi "
        "ORDER BY month_start DESC"
    ),
    "Q08_本月巡檢": (
        "SELECT * FROM public.vw_manager_inspections "
        "WHERE inspection_date >= date_trunc('month', CURRENT_DATE)::date "
        "ORDER BY inspect_time DESC"
    ),
    "Q09_本月報修": (
        "SELECT * FROM public.vw_manager_repairs "
        "WHERE created_at >= date_trunc('month', CURRENT_DATE) "
        "ORDER BY created_at DESC"
    ),
    "Q10_派工維修": (
        "SELECT * FROM public.vw_manager_maintenance_orders "
        "ORDER BY created_at DESC"
    ),
}


def connect_to_office(port: int):
    local_context = uno.getComponentContext()
    resolver = local_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_context
    )
    return resolver.resolve(
        f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
    )


def create_database(output: Path, port: int) -> None:
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite existing file: {output}")

    output.parent.mkdir(parents=True, exist_ok=True)
    context = connect_to_office(port)
    database_context = context.ServiceManager.createInstanceWithContext(
        "com.sun.star.sdb.DatabaseContext", context
    )
    data_source = database_context.createInstance()
    data_source.URL = (
        "sdbc:postgresql:"
        f"dbname={DATABASE} host={POOLER_HOST} port={POOLER_PORT} sslmode=require"
    )
    data_source.User = DATABASE_USER
    data_source.IsPasswordRequired = True
    data_source.Password = ""

    query_definitions = data_source.getQueryDefinitions()
    for name, command in QUERIES.items():
        query = query_definitions.createInstance()
        query.Command = command
        query.EscapeProcessing = False
        query_definitions.insertByName(name, query)

    document = data_source.DatabaseDocument
    document.storeAsURL(uno.systemPathToFileUrl(str(output.resolve())), ())
    document.close(True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--uno-port", type=int, default=2083)
    args = parser.parse_args()
    create_database(args.output, args.uno_port)
    print(f"Created {args.output.resolve()}")


if __name__ == "__main__":
    main()
