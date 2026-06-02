package com.mazebingo;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.mazebingo.model.MazeState;
import com.mazebingo.model.ProgressResponse;
import com.mazebingo.model.TileProgressResponse;
import okhttp3.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.inject.Inject;
import javax.inject.Singleton;

@Singleton
public class MazeApiClient {

    private static final Logger log = LoggerFactory.getLogger(MazeApiClient.class);

    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");

    @Inject
    private OkHttpClient httpClient;

    @Inject
    private Gson gson;

    public MazeState fetchMazeState(String apiUrl, String team) {
        HttpUrl url = HttpUrl.parse(apiUrl + "/api/maze")
            .newBuilder()
            .addQueryParameter("team", team)
            .build();

        Request request = new Request.Builder().url(url).get().build();
        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                log.warn("Maze API returned {}", response.code());
                return null;
            }
            return gson.fromJson(response.body().charStream(), MazeState.class);
        } catch (Exception e) {
            log.warn("Failed to fetch maze state", e);
            return null;
        }
    }

    public ProgressResponse postProgress(String apiUrl, int tileId, String playerName, int amount, String team, String subCategory) {
        HttpUrl url = HttpUrl.parse(apiUrl + "/api/tiles/progress/" + tileId)
            .newBuilder()
            .addQueryParameter("team", team)
            .build();

        JsonObject body = new JsonObject();
        body.addProperty("playerName", playerName);
        body.addProperty("amount", amount);
        if (subCategory != null) {
            body.addProperty("subCategory", subCategory);
        }

        RequestBody requestBody = RequestBody.create(JSON_MEDIA_TYPE, gson.toJson(body));
        Request request = new Request.Builder().url(url).post(requestBody).build();
        try (Response response = httpClient.newCall(request).execute()) {
            if (response.body() == null) {
                log.warn("Progress POST for tile {} returned {} with no body", tileId, response.code());
                return null;
            }
            ProgressResponse result = gson.fromJson(response.body().charStream(), ProgressResponse.class);
            if (!response.isSuccessful()) {
                log.warn("Progress POST for tile {} returned {}", tileId, response.code());
            }
            return result;
        } catch (Exception e) {
            log.warn("Failed to post progress for tile {}", tileId, e);
            return null;
        }
    }

    public String fetchStateVersion(String apiUrl, String team) {
        HttpUrl url = HttpUrl.parse(apiUrl + "/api/state-version")
            .newBuilder()
            .addQueryParameter("team", team)
            .build();

        Request request = new Request.Builder().url(url).get().build();
        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) return null;
            JsonObject obj = gson.fromJson(response.body().charStream(), JsonObject.class);
            return obj.has("lastUpdated") && !obj.get("lastUpdated").isJsonNull()
                ? obj.get("lastUpdated").getAsString() : null;
        } catch (Exception e) {
            log.warn("Failed to fetch state version", e);
            return null;
        }
    }

    public TileProgressResponse fetchTileProgress(String apiUrl, int tileId, String team) {
        HttpUrl url = HttpUrl.parse(apiUrl + "/api/tiles/progress/" + tileId)
            .newBuilder()
            .addQueryParameter("team", team)
            .build();

        Request request = new Request.Builder().url(url).get().build();
        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                log.warn("Tile progress GET for tile {} returned {}", tileId, response.code());
                return null;
            }
            return gson.fromJson(response.body().charStream(), TileProgressResponse.class);
        } catch (Exception e) {
            log.warn("Failed to fetch tile progress for tile {}", tileId, e);
            return null;
        }
    }
}
