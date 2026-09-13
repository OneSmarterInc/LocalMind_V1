from django.urls import path
from . import views

urlpatterns = [
    path("quizzes/", views.QuizListCreateView.as_view(), name="quizzes-list"),
    path("quizzes/generate/", views.QuizGenerateView.as_view(), name="quizzes-generate"),
    path("quizzes/<uuid:quiz_id>/", views.QuizDetailView.as_view(), name="quizzes-detail"),
    path("quizzes/<uuid:quiz_id>/status/", views.QuizStatusView.as_view(), name="quizzes-status"),
    path("quizzes/<uuid:quiz_id>/attempts/", views.QuizAttemptsView.as_view(), name="quizzes-attempts"),
    path("quizzes/<uuid:quiz_id>/release-results/", views.QuizReleaseResultsView.as_view(), name="quizzes-release-results"),
    path("quiz-attempts/<uuid:attempt_id>/re-evaluate/", views.AttemptReEvaluateView.as_view(), name="quiz-attempt-reevaluate"),
]
