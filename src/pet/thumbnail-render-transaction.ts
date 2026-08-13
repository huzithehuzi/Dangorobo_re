type ThumbnailRestoreStep = () => void;

function runThumbnailRenderTransaction<TResult>(
  render: () => TResult,
  restoreSteps: readonly ThumbnailRestoreStep[]
): TResult {
  let result!: TResult;
  let renderFailed = false;
  let renderError: unknown;
  const restoreErrors: unknown[] = [];

  try {
    result = render();
  } catch (error) {
    renderFailed = true;
    renderError = error;
  } finally {
    for (const restore of restoreSteps) {
      try {
        restore();
      } catch (error) {
        restoreErrors.push(error);
      }
    }
  }

  if (renderFailed) {
    if (restoreErrors.length) {
      throw new AggregateError(
        [renderError, ...restoreErrors],
        "프리셋 썸네일 렌더와 라이브 씬 복구에 모두 실패했다",
        { cause: renderError }
      );
    }
    throw renderError;
  }
  if (restoreErrors.length === 1) throw restoreErrors[0];
  if (restoreErrors.length > 1) {
    throw new AggregateError(restoreErrors, "프리셋 썸네일 렌더 뒤 라이브 씬 복구에 실패했다");
  }
  return result;
}

export { runThumbnailRenderTransaction };
