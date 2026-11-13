import { LiveValue } from "@/components/ui/LiveValue";
import { factory } from "@/lib/data/live";
import { getDirectorySnapshot } from "./directory-snapshot";
import { DirectoryUnavailable, StrategyDirectory } from "./StrategyDirectory";

export async function LiveStrategyDirectory() {
  const { list, at } = await getDirectorySnapshot();
  return (
    <LiveValue
      read={list}
      fallback={() => <DirectoryUnavailable />}
      render={(items) => (
        <StrategyDirectory
          practiceJudge={factory.practice.judge}
          deleverJudge={factory.delever.judge}
          items={items}
          workspace
          at={at}
        />
      )}
    />
  );
}
