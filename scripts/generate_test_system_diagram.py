"""Generate the test-system architecture diagram.

Requires the optional ``diagram`` dependency and Graphviz (``dot``).
"""

from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.generic.blank import Blank
from diagrams.generic.compute import Rack
from diagrams.generic.database import SQL
from diagrams.generic.storage import Storage


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "test-system"


def main() -> None:
    with Diagram(
        "GuardDuty Sentinel integration test system",
        filename=str(OUTPUT),
        outformat="png",
        direction="LR",
        show=False,
        graph_attr={"pad": "0.3", "splines": "ortho"},
    ):
        with Cluster("Deterministic PR gates"):
            contracts = Blank("AWS + Azure\ncontracts")
            unit = Blank("unit + property\ntests")
            mutation = Blank("mutation\ntests")

        with Cluster("Docker integration gates"):
            localstack = Rack("LocalStack\nS3 / SQS")
            kusto = SQL("Kusto\nemulator")

        with Cluster("Live conformance"):
            aws = Rack("AWS sandbox\nGuardDuty + EventBridge")
            s3 = Storage("S3 export\n+ SQS")
            azure = SQL("Microsoft Sentinel\nDCR / AWSGuardDuty")

        contracts >> Edge(label="validate") >> unit
        unit >> Edge(label="gates") >> localstack
        unit >> Edge(label="gates") >> kusto
        unit >> Edge(label="mutate") >> mutation
        aws >> Edge(label="event route") >> azure
        s3 >> Edge(label="connector route") >> azure
        localstack >> Edge(label="transport contract") >> azure
        kusto >> Edge(label="KQL contract") >> azure


if __name__ == "__main__":
    main()
