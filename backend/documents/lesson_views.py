"""Visual-aware faculty/admin lesson preview endpoints."""
import base64

from documents.services.visuals import visual_path

from . import views as base_views


def _visuals(module):
    document = module.chapter.document
    rows = []
    for visual in module.source_visuals or []:
        path = visual_path(document, module, str(visual.get("id") or ""))
        if path is None or not path.is_file():
            continue
        rows.append({
            "id": visual.get("id"),
            "kind": visual.get("kind", "figure"),
            "page": visual.get("page"),
            "caption": visual.get("caption", "Source visual"),
            "width": visual.get("width"),
            "height": visual.get("height"),
            "data_url": "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii"),
        })
    return rows


def _enrich(response, module):
    data = response.data
    if isinstance(data, dict) and data.get("lesson"):
        lesson = dict(data["lesson"])
        lesson["source_visuals"] = _visuals(module)
        data = {**data, "lesson": lesson}
        response.data = data
    return response


class ModuleLessonView(base_views.ModuleLessonView):
    """Existing lesson endpoint plus original cropped source visuals."""

    def get(self, request, module_id):
        module = self._module(request, module_id)
        return _enrich(super().get(request, module_id), module)

    def post(self, request, module_id):
        module = self._module(request, module_id)
        return _enrich(super().post(request, module_id), module)
